const express = require('express');
const net = require('net');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// CONFIGURACIÓN DE LA BALANZA
const SCALE_IP = '192.168.1.150'; // 🔥 Pon la IP real aquí
const SCALE_PORT = 1001;

app.post('/enviar-balanza', (req, res) => {
    const { productos } = req.body;
    const client = new net.Socket();

    // Timeout de 5 segundos para no colgar el proceso
    client.setTimeout(5000);

    client.connect(SCALE_PORT, SCALE_IP, () => {
        console.log('✅ Conectado a la balanza. Enviando...');
        
        productos.forEach(p => {
            // PROTOCOLO L-PRODUCT NATIVO
            // P (Carga) + PLU (4 digitos) + PRECIO (6 digitos sin punto) + NOMBRE (20 chars)
            const comando = "P";
            const plu = String(p.code).padStart(4, '0').slice(-4);
            const precio = String(Math.round(p.price * 100)).padStart(6, '0').slice(-6);
            const nombre = p.name.substring(0, 20).toUpperCase().padEnd(20, ' ');

            const trama = `${comando}${plu}${precio}${nombre}\r\n`;
            client.write(trama);
        });

        client.end();
        res.json({ success: true, message: 'Sincronización completa' });
    });

    client.on('error', (err) => {
        console.error('❌ Error de socket:', err.message);
        res.status(500).json({ success: false, error: err.message });
    });

    client.on('timeout', () => {
        client.destroy();
        res.status(504).json({ success: false, error: 'La balanza no responde' });
    });
});

app.listen(9000, () => console.log('🚀 NoarBridge corriendo en http://localhost:9000'));