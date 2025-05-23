const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const FormData = require('form-data');
const { exec } = require('child_process');

const app = express();
const PORT = 5000;
const PHOTO_DIR = './photos';

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Buat folder jika belum ada
if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR);

// Fungsi bantu: cari file terbaru
function getLatestPhoto(folderPath) {
  const files = fs.readdirSync(folderPath)
    .filter(f => f.endsWith('.jpg'))
    .map(f => ({
      name: f,
      time: fs.statSync(path.join(folderPath, f)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time);
  return files.length > 0 ? path.join(folderPath, files[0].name) : null;
}

// Endpoint untuk ambil foto DSLR via DigiCamControl
app.post('/take-photo', async (req, res) => {
  const { order_id, total_slot } = req.body;
  if (!order_id || !total_slot) {
    return res.status(400).json({ message: 'order_id dan total_slot wajib' });
  }

  const folderPath = path.join(process.env.HOMEPATH, 'Pictures', 'digiCamControl');
  const results = [];

  try {
    for (let i = 1; i <= total_slot; i++) {
      await axios.get('http://localhost:5513/?action=capture');
      await new Promise(resolve => setTimeout(resolve, 3000)); // Delay antara foto

      const latestPhoto = getLatestPhoto(folderPath);
      if (!latestPhoto) throw new Error(`Foto ke-${i} tidak ditemukan`);

      const formData = new FormData();
      formData.append('order_id', order_id);
      formData.append('frame_id', req.body.frame_id); // Penting
      formData.append(`photo_${i}`, fs.createReadStream(latestPhoto), {
        filename: `slot${i}.jpg`,
        contentType: 'image/jpeg',
      });

      const upload = await axios.post('http://127.0.0.1:8000/photo-upload', formData, {
        headers: formData.getHeaders(),
      });

      results.push({ i, message: 'Foto berhasil dikirim' });
    }

    res.json({ message: 'Semua foto berhasil diambil dan dikirim', results });

  } catch (err) {
    console.error('Gagal:', err.message);
    res.status(500).json({ message: 'Gagal dalam proses foto', error: err.message });
  }
});


// Fungsi bantu untuk mencetak foto
function print(filePath) {
  return new Promise((resolve, reject) => {
    // Ganti "Printer_Name" sesuai nama printer di Control Panel
    const printerName = 'Printer_Name'; // TODO: sesuaikan!
    const command = `start /min mspaint /pt "${filePath}" "${printerName}"`;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        return reject(error);
      }
      resolve(stdout);
    });
  });
}

// Endpoint cetak foto dari URL
app.post('/print-photo', async (req, res) => {
  const { photo_url } = req.body;
  if (!photo_url) {
    return res.status(400).json({ message: 'photo_url tidak boleh kosong' });
  }

  const filename = `print_${Date.now()}.jpg`;
  const downloadPath = path.join(PHOTO_DIR, filename);

  try {
    // Download file foto
    const response = await axios.get(photo_url, { responseType: 'stream' });
    const writer = fs.createWriteStream(downloadPath);
    response.data.pipe(writer);

    writer.on('finish', async () => {
      try {
        await print(downloadPath);
        res.json({ message: 'Foto berhasil dicetak' });
      } catch (err) {
        console.error('Gagal mencetak:', err);
        res.status(500).json({ message: 'Gagal mencetak', error: err.message });
      }
    });

    writer.on('error', err => {
      console.error('Gagal menyimpan file:', err);
      res.status(500).json({ message: 'Gagal menyimpan file untuk dicetak', error: err.message });
    });

  } catch (error) {
    console.error('Gagal download foto:', error.message);
    res.status(500).json({ message: 'Gagal download foto dari URL', error: error.message });
  }
});

// Jalankan server
app.listen(PORT, () => {
  console.log(`NodeJS server running on http://localhost:${PORT}`);
});
