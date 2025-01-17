require('dotenv').config();
const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const sharp = require('sharp');
const fetch = require('node-fetch');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

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
/*app.get('/cover-64x64', async (req, res) => {
    try {
        await refreshAccessTokenIfNeeded(); // Refresca el token si es necesario
        const playbackState = await spotifyApi.getMyCurrentPlaybackState();

        if (!playbackState.body || !playbackState.body.is_playing || !playbackState.body.item) {
            console.log('No se está reproduciendo ninguna canción.');
            return res.status(404).send('No se está reproduciendo ninguna canción.');
        }

        const item = playbackState.body.item;

        try {
            const coverUrl = item.album.images[0].url;
        }catch (err) {
            console.error('/cover-64x64 error:', err);
            res.status(500).send('Error al procesar la portada.');
        }

        console.log('Cover URL:', coverUrl);

        const response = await fetch(coverUrl);
        const buffer = Buffer.from(await response.arrayBuffer());

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
});*/

app.get('/cover-64x64', async (req, res) => {
    try {
        await refreshAccessTokenIfNeeded(); // Refresca el token si es necesario
        const playbackState = await spotifyApi.getMyCurrentPlayingTrack();

        if (!playbackState.body || !playbackState.body.item) {
            console.log(console.body);
            return res.status(404).send('No se está reproduciendo ninguna canción.');
        }

        console.log('Cover URL:', playbackState.body.item);

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


app.get('/id-playing', async (req, res) => {
    try {
        await refreshAccessTokenIfNeeded(); // Asegúrate de que el token está actualizado
        const playbackState = await spotifyApi.getMyCurrentPlaybackState();

        // Verificar si hay canción en reproducción
        if (!playbackState.body || playbackState.body.is_playing === false) {
            return res.json({ id: "" }); // Devuelve un string vacío si no hay canción
        }

        let songId = ""; // ID de la canción
        if(playbackState.body.item){
            songId = playbackState.body.item.id
        }else{
            songId = playbackState.body.id
        }
        res.json({ id: songId }); // Devuelve el ID de la canción en JSON
    } catch (err) {
        console.error('/id-playing error:', err);
        res.status(500).json({ error: 'Error al obtener la canción actual.' });
    }
});



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


// -------------------------------------------------------------------
// Iniciar servidor
// -------------------------------------------------------------------
app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
    const refreshToken = loadRefreshToken();
    if (refreshToken) {
        spotifyApi.setRefreshToken(refreshToken);
    }
});
