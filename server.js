require('dotenv').config();
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const sharp = require('sharp');
const fetch = require('node-fetch');
const fs = require('fs');

// Dependencias para el bot de Telegram y Supabase Storage
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const BUCKET_NAME = process.env.BUCKET_NAME; // Nombre del bucket definido en las variables de entorno

// Configuración de Spotify
const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI,
});

let ACCESS_TOKEN = null;
const REFRESH_TOKEN_FILE = './refresh_token.cache';

// -------------------------------------------------------------------
// 1. Cargar el Refresh Token desde el archivo (si existe)
// -------------------------------------------------------------------
function loadRefreshToken() {
    if (fs.existsSync(REFRESH_TOKEN_FILE)) {
        const token = fs.readFileSync(REFRESH_TOKEN_FILE, 'utf-8').trim();
        console.log('Refresh Token cargado desde el archivo.');
        return token;
    }
    return null;
}

// -------------------------------------------------------------------
// 2. Guardar el Refresh Token en un archivo
// -------------------------------------------------------------------
function saveRefreshToken(token) {
    fs.writeFileSync(REFRESH_TOKEN_FILE, token, 'utf-8');
    console.log('Refresh Token guardado en el archivo.');
}

// -------------------------------------------------------------------
// 3. Actualizar el Access Token automáticamente
// -------------------------------------------------------------------
async function refreshAccessTokenIfNeeded() {
    try {
        const data = await spotifyApi.refreshAccessToken();
        ACCESS_TOKEN = data.body.access_token;
        spotifyApi.setAccessToken(ACCESS_TOKEN);
    } catch (err) {
        console.error('Error al refrescar el Access Token:', err);
        throw new Error('No se pudo refrescar el Access Token.');
    }
}

// -------------------------------------------------------------------
// 4. Ruta de login inicial (solo necesitas hacerlo una vez)
// -------------------------------------------------------------------
app.get('/login', (req, res) => {
    const scopes = [
        'user-read-currently-playing',
        'user-read-playback-state',
        'user-read-private',
    ];
    const authorizeURL = spotifyApi.createAuthorizeURL(scopes);
    res.redirect(authorizeURL);
});

// -------------------------------------------------------------------
// 5. Callback para manejar el intercambio de tokens
// -------------------------------------------------------------------
app.get('/callback', async (req, res) => {
    const code = req.query.code || null;
    if (!code) return res.send('Error: falta el parámetro "code".');

    try {
        const data = await spotifyApi.authorizationCodeGrant(code);
        ACCESS_TOKEN = data.body.access_token;
        const refreshToken = data.body.refresh_token;

        spotifyApi.setAccessToken(ACCESS_TOKEN);
        spotifyApi.setRefreshToken(refreshToken);

        saveRefreshToken(refreshToken); // Guardar el Refresh Token permanentemente
        res.send('¡Autorización exitosa! Ahora puedes usar el servidor.');
    } catch (err) {
        console.error('Error en el intercambio de tokens:', err);
        res.status(500).send('Error al obtener el token.');
    }
});

// -------------------------------------------------------------------
// 6. Ruta para obtener la portada en formato 64x64
// -------------------------------------------------------------------
app.get('/cover-64x64', async (req, res) => {
    try {
        await refreshAccessTokenIfNeeded(); // Refresca el token si es necesario
        const playbackState = await spotifyApi.getMyCurrentPlayingTrack();

        if (!playbackState.body || !playbackState.body.item) {
            return res.status(404).send('No se está reproduciendo ninguna canción.');
        }

        const coverUrl = playbackState.body.item.album.images[0].url;
        const response = await fetch(coverUrl);
        const buffer = Buffer.from(await response.arrayBuffer());

        const metadata = await sharp(buffer).metadata();

        const resizedBuffer = await sharp(buffer)
            .resize(64, 64)
            .ensureAlpha()
            .raw()
            .toBuffer();

        const pixelData = [];
        for (let y = 0; y < 64; y++) {
            const row = [];
            for (let x = 0; x < 64; x++) {
                const idx = (y * 64 + x) * 4;
                const r = resizedBuffer[idx];
                const g = resizedBuffer[idx + 1];
                const b = resizedBuffer[idx + 2];

                // Convertir a RGB565
                const rgb565 = ((b & 0b11111000) << 8) | // 5 bits de rojo
                    ((r & 0b11111100) << 3) | // 6 bits de verde
                    (g >> 3);                 // 5 bits de azul
                row.push(rgb565); // Agregar el entero int16
            }
            pixelData.push(row);
        }

        res.json({
            width: 64,
            height: 64,
            data: pixelData,
        });
    } catch (err) {
        console.error('/cover-64x64 error:', err);
        res.status(500).send('Error al procesar la portada.');
    }
});

// -------------------------------------------------------------------
// 7. Ruta para obtener el ID de la canción que se está reproduciendo
// -------------------------------------------------------------------
app.get('/id-playing', async (req, res) => {
    try {
        await refreshAccessTokenIfNeeded(); // Asegúrate de que el token está actualizado
        const playbackState = await spotifyApi.getMyCurrentPlaybackState();

        // Verificar si hay canción en reproducción
        if (!playbackState.body || playbackState.body.is_playing === false) {
            return res.json({ id: "" }); // Devuelve un string vacío si no hay canción
        }

        let songId = ""; // ID de la canción
        if (playbackState.body.item) {
            songId = playbackState.body.item.id;
        } else {
            songId = playbackState.body.id;
        }
        res.json({ id: songId }); // Devuelve el ID de la canción en JSON
    } catch (err) {
        console.error('/id-playing error:', err);
        res.status(500).json({ error: 'Error al obtener la canción actual.' });
    }
});

// -------------------------------------------------------------------
// 8. Ruta para obtener información del usuario
// -------------------------------------------------------------------
app.get('/me', async (req, res) => {
    try {
        await refreshAccessTokenIfNeeded(); // Refresca el token si es necesario
        const meData = await spotifyApi.getMe();
        res.json({
            display_name: meData.body.display_name,
            email: meData.body.email,
            country: meData.body.country,
        });
    } catch (err) {
        console.error('/me error:', err);
        res.status(500).send('Error al obtener información del usuario.');
    }
});

// Nueva ruta para obtener la URL pública de una foto por su nombre
app.get('/get-photo-url', async (req, res) => {
    const fileName = req.query.fileName;
    if (!fileName) {
        return res.status(400).send('Error: falta el parámetro "fileName".');
    }

    try {
        // Consulta a Supabase para obtener el archivo por su nombre
        const { data: fileData, error: fileError } = await supabase
            .storage
            .from(BUCKET_NAME)
            .list('', {
                search: fileName,
            });

        if (fileError || fileData.length === 0) {
            console.error('Error al obtener el archivo:', fileError ? fileError.message : 'Archivo no encontrado');
            return res.status(404).send('Archivo no encontrado.');
        }

        // Obtener la URL pública del archivo
        const { publicURL, error: publicError } = await supabase
            .storage
            .from(BUCKET_NAME)
            .getPublicUrl(fileName);

        if (publicError) {
            console.error('Error al obtener la URL pública:', publicError.message);
            return res.status(500).send('Error al obtener la URL pública.');
        }

        res.json({ publicURL });
    } catch (err) {
        console.error('/get-photo-url error:', err);
        res.status(500).send('Error al procesar la solicitud.');
    }
});

// Nueva ruta para obtener información de una foto por su ID
app.get('/get-photo', async (req, res) => {
    console.log("Pidieron foto")
    console.log(req.query);
    const id = parseInt(req.query.id, 10);
    if (isNaN(id) || id < 0) {
        return res.status(400).send('Error: parámetro "id" inválido.');
    }

    try {
        // Consulta a Supabase para obtener las últimas 5 fotos subidas
        const { data: photos, error } = await supabase
            .from('photos')
            .select('photo_url, title, username')
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) {
            console.error('Error al obtener las fotos:', error.message);
            return res.status(500).send('Error al obtener las fotos.');
        }

        if (id >= photos.length) {
            return res.status(404).send('Foto no encontrada.');
        }

        const photo = photos[id];
        const response = await fetch(photo.photo_url);
        const buffer = Buffer.from(await response.arrayBuffer());

        // Recortar la imagen para que sea 1:1 y centrada
        const metadata = await sharp(buffer).metadata();
        const size = Math.min(metadata.width, metadata.height);
        const left = Math.floor((metadata.width - size) / 2);
        const top = Math.floor((metadata.height - size) / 2);
        const resizedBuffer = await sharp(buffer)
            .extract({ left, top, width: size, height: size })
            .resize(64, 64)
            .ensureAlpha()
            .raw()
            .toBuffer();

        const pixelData = [];
        for (let y = 0; y < 64; y++) {
            const row = [];
            for (let x = 0; x < 64; x++) {
                const idx = (y * 64 + x) * 4;
                const r = resizedBuffer[idx];
                const g = resizedBuffer[idx + 1];
                const b = resizedBuffer[idx + 2];

                // Convertir a RGB565
                const rgb565 = ((b & 0b11111000) << 8) | // 5 bits de rojo
                    ((r & 0b11111100) << 3) | // 6 bits de verde
                    (g >> 3);                 // 5 bits de azul
                row.push(rgb565); // Agregar el entero int16
            }
            pixelData.push(row);
        }

        // Quitar solo los acentos de photo.username y photo.title
        const cleanUsername = photo.username.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const clearTitle = photo.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        res.json({
            photo: {
                width: 64,
                height: 64,
                data: pixelData,
            },
            title: clearTitle,
            username: cleanUsername,
        });
    } catch (err) {
        console.error('/get-photo error:', err);
        res.status(500).send('Error al procesar la solicitud.');
    }
});

// -------------------------------------------------------------------
// Iniciar el servidor Express
// -------------------------------------------------------------------
app.listen(port, () => {
    console.log(`Servidor escuchando en ${port}`);
    const refreshToken = loadRefreshToken();
    if (refreshToken) {
        spotifyApi.setRefreshToken(refreshToken);
    }
});

// Solo se inicializa el bot si se ha definido el token en las variables de entorno
if (process.env.TELEGRAM_BOT_TOKEN) {
    // Inicializamos el bot en modo polling
    const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
    console.log('Bot de Telegram iniciado y escuchando mensajes...');

    // Manejador para mensajes que contienen fotos
    bot.on('photo', async (msg) => {
        const chatId = msg.chat.id;
        // Seleccionamos la foto de mayor resolución (la última en el array)
        const photoArray = msg.photo;
        const photo = photoArray[photoArray.length - 1];
        const fileId = photo.file_id;

        try {
            // Obtenemos la información del archivo usando la API de Telegram
            const file = await bot.getFile(fileId);
            // Construimos la URL para descargar la imagen
            const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

            // Descargamos la imagen con axios en formato binario
            const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
            const fileData = response.data;

            // Generamos un nombre único para el archivo (se asume extensión jpg)
            const fileName = `${uuidv4()}.jpg`;

            // Subimos el archivo a Supabase Storage
            const { data, error } = await supabase
                .storage
                .from(BUCKET_NAME)
                .upload(fileName, fileData, {
                    contentType: 'image/jpeg'
                });

            if (error) {
                console.error('Error al subir la imagen:', error.message);
                bot.sendMessage(chatId, 'Error al subir la imagen a Supabase: ' + error.message);
                return;
            }
            // Obtenemos la URL pública de la imagen subida
            const { data: dataURL } = await supabase
                .storage
                .from(BUCKET_NAME)
                .getPublicUrl(fileName);
            

            if (dataURL.error) {
                console.error('Error al obtener la URL pública:', dataURL.error.message);
                bot.sendMessage(chatId, 'Error al obtener la URL pública: ' + dataURL.error.message);
                return;
            }

            // Añadir la URL pública a la base de datos
            const { data: insertData, error: insertError } = await supabase
                .from('photos')
                .insert([{ photo_url: dataURL.publicUrl, username: msg.from.first_name ?? '', title: msg.caption ?? '' }]);
            if (insertError) {
                console.error('Error al insertar en la base de datos:', insertError.message);
            }

            bot.sendMessage(chatId, '✔️ Imagen subida correctamente');
        } catch (err) {
            console.error('Error procesando la foto:', err);
            bot.sendMessage(chatId, 'Ocurrió un error al procesar la foto.');
        }
    });
}
