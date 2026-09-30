const cloudinary = require("../config/cloudinary");

const subirImagen = async (req, res) => {
  console.log("📸 Entró petición a /upload");

  try {
    if (!req.file) {
      console.log("❌ No llegó ningún archivo");

      return res.status(400).json({
        ok: false,
        mensaje: "Debes seleccionar una imagen",
      });
    }

    console.log("✅ Archivo recibido:");
    console.log("Nombre:", req.file.originalname);
    console.log("Tipo:", req.file.mimetype);
    console.log("Tamaño:", req.file.size);

    console.log("☁️ Intentando subir a Cloudinary...");

    const resultado = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "luper/productos",
          resource_type: "image",
          timeout: 30000,
        },
        (error, result) => {
          if (error) {
            console.error("❌ Cloudinary respondió con error:", error);
            reject(error);
            return;
          }

          console.log("☁️ Cloudinary respondió correctamente");
          resolve(result);
        }
      );

      stream.on("error", (error) => {
        console.error("❌ Error en stream:", error);
        reject(error);
      });

      stream.end(req.file.buffer);
    });

    console.log("🔥 Imagen subida:", resultado.secure_url);

    return res.status(201).json({
      ok: true,
      mensaje: "Imagen subida correctamente",
      imagen: resultado.secure_url,
      publicId: resultado.public_id,
    });
  } catch (error) {
    console.error("❌ ERROR SUBIENDO IMAGEN:");
    console.error(error);

    return res.status(500).json({
      ok: false,
      mensaje: "Error subiendo la imagen",
      error: error.message,
    });
  }
};

module.exports = {
  subirImagen,
};