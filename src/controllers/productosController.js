const pool = require("../config/db");
const cloudinary = require("../config/cloudinary");

// GET /productos
const obtenerProductos = async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT
        id,
        modelo,
        categoria,
        talla,
        imagen,
        estado,
        creado_en
      FROM productos
      ORDER BY id DESC
    `);

    res.status(200).json(resultado.rows);
  } catch (error) {
    console.error("Error obteniendo productos:", error.message);

    res.status(500).json({
      ok: false,
      mensaje: "Error obteniendo los productos",
    });
  }
};

// POST /productos
const crearProducto = async (req, res) => {
  try {
    const { modelo, categoria, talla, imagen, imagen_public_id } = req.body;

    if (!modelo || !categoria || !talla) {
      return res.status(400).json({
        ok: false,
        mensaje: "Modelo, categoría y talla son obligatorios",
      });
    }

    const resultado = await pool.query(
      `
  INSERT INTO productos
    (
      modelo,
      categoria,
      talla,
      imagen,
      imagen_public_id
    )
  VALUES
    ($1, $2, $3, $4, $5)
  RETURNING *
  `,
      [modelo, categoria, talla, imagen || null, imagen_public_id || null],
    );
    res.status(201).json({
      ok: true,
      mensaje: "Producto creado correctamente",
      producto: resultado.rows[0],
    });
  } catch (error) {
    console.error("Error creando producto:", error.message);

    res.status(500).json({
      ok: false,
      mensaje: "Error creando el producto",
    });
  }
};

// PUT /productos/:id
const actualizarProducto = async (req, res) => {
  try {
    const { id } = req.params;
    const { modelo, categoria, talla, imagen, estado } = req.body;

    const productoActual = await pool.query(
      "SELECT * FROM productos WHERE id = $1",
      [id],
    );

    if (productoActual.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: "Producto no encontrado",
      });
    }

    const actual = productoActual.rows[0];

    const resultado = await pool.query(
      `
      UPDATE productos
      SET
        modelo = $1,
        categoria = $2,
        talla = $3,
        imagen = $4,
        estado = $5
      WHERE id = $6
      RETURNING *
      `,
      [
        modelo ?? actual.modelo,
        categoria ?? actual.categoria,
        talla ?? actual.talla,
        imagen ?? actual.imagen,
        estado ?? actual.estado,
        id,
      ],
    );

    res.status(200).json({
      ok: true,
      mensaje: "Producto actualizado correctamente",
      producto: resultado.rows[0],
    });
  } catch (error) {
    console.error("Error actualizando producto:", error.message);

    res.status(500).json({
      ok: false,
      mensaje: "Error actualizando el producto",
    });
  }
};

// DELETE /productos/:id
const eliminarProducto = async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar primero el producto
    const productoEncontrado = await pool.query(
      `
      SELECT *
      FROM productos
      WHERE id = $1
      `,
      [id],
    );

    if (productoEncontrado.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: "Producto no encontrado",
      });
    }

    const producto = productoEncontrado.rows[0];

    // Si la imagen pertenece a Cloudinary,
    // eliminarla primero de Cloudinary
    if (producto.imagen_public_id) {
      console.log(
        "☁️ Eliminando imagen de Cloudinary:",
        producto.imagen_public_id,
      );

      const resultadoCloudinary = await cloudinary.uploader.destroy(
        producto.imagen_public_id,
      );

      console.log("☁️ Resultado Cloudinary:", resultadoCloudinary);
    }

    // Eliminar producto de PostgreSQL
    const resultado = await pool.query(
      `
      DELETE FROM productos
      WHERE id = $1
      RETURNING *
      `,
      [id],
    );

    console.log("🗑️ Producto eliminado de PostgreSQL:", producto.modelo);

    return res.status(200).json({
      ok: true,
      mensaje: "Producto e imagen eliminados correctamente",
      producto: resultado.rows[0],
    });
  } catch (error) {
    console.error("❌ Error eliminando producto:", error);

    return res.status(500).json({
      ok: false,
      mensaje: "Error eliminando el producto",
      error: error.message,
    });
  }
};

module.exports = {
  obtenerProductos,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
};
