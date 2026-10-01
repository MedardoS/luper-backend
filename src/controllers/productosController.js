const pool = require("../config/db");
const cloudinary = require("../config/cloudinary");

// GET /productos
const obtenerProductos = async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT
        p.id,
        p.modelo,
        p.categoria,
        p.talla,
        p.imagen,
        p.estado,
        p.creado_en,

        COALESCE(
          json_agg(
            json_build_object(
              'id', pt.id,
              'talla', pt.talla,
              'stock', pt.stock
            )
            ORDER BY pt.talla
          ) FILTER (WHERE pt.id IS NOT NULL),
          '[]'::json
        ) AS tallas

      FROM productos p

      LEFT JOIN producto_tallas pt
        ON pt.producto_id = p.id

      GROUP BY
        p.id,
        p.modelo,
        p.categoria,
        p.talla,
        p.imagen,
        p.estado,
        p.creado_en

      ORDER BY p.id DESC
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
  const client = await pool.connect();

  try {
    const {
      modelo,
      categoria,
      tallas,
      imagen,
      imagen_public_id,
    } = req.body;

    // ================================
    // VALIDACIONES
    // ================================

    if (!modelo || !categoria) {
      return res.status(400).json({
        ok: false,
        mensaje: "Modelo y categoría son obligatorios",
      });
    }

    if (!Array.isArray(tallas) || tallas.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: "Debes agregar al menos una talla",
      });
    }

    const tallasNormalizadas = tallas.map((item) => ({
      talla: String(item.talla ?? "").trim(),
      stock: Number(item.stock),
    }));

    const tallaInvalida = tallasNormalizadas.some(
      (item) =>
        !item.talla ||
        !Number.isInteger(item.stock) ||
        item.stock < 0
    );

    if (tallaInvalida) {
      return res.status(400).json({
        ok: false,
        mensaje:
          "Cada talla debe tener un nombre y un stock entero igual o mayor a 0",
      });
    }

    const nombresTallas = tallasNormalizadas.map(
      (item) => item.talla
    );

    const tieneDuplicadas =
      new Set(nombresTallas).size !== nombresTallas.length;

    if (tieneDuplicadas) {
      return res.status(400).json({
        ok: false,
        mensaje: "No puedes repetir una talla en el mismo producto",
      });
    }

    // ================================
    // TRANSACCIÓN
    // ================================

    await client.query("BEGIN");

    /*
      La columna productos.talla todavía existe
      y actualmente es NOT NULL.

      Por compatibilidad temporal guardamos allí
      la primera talla del producto.

      Más adelante podremos retirar esa columna
      cuando todo el frontend use producto_tallas.
    */

    const tallaPrincipal = tallasNormalizadas[0].talla;

    const resultadoProducto = await client.query(
      `
        INSERT INTO productos
        (
          modelo,
          categoria,
          talla,
          imagen,
          imagen_public_id
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [
        modelo.trim(),
        categoria,
        tallaPrincipal,
        imagen || null,
        imagen_public_id || null,
      ]
    );

    const producto = resultadoProducto.rows[0];

    // ================================
    // GUARDAR TALLAS Y STOCK
    // ================================

    for (const item of tallasNormalizadas) {
      await client.query(
        `
          INSERT INTO producto_tallas
          (
            producto_id,
            talla,
            stock
          )
          VALUES ($1, $2, $3)
        `,
        [
          producto.id,
          item.talla,
          item.stock,
        ]
      );
    }

    await client.query("COMMIT");

    // ================================
    // DEVOLVER PRODUCTO COMPLETO
    // ================================

    const resultadoFinal = await pool.query(
      `
        SELECT
          p.id,
          p.modelo,
          p.categoria,
          p.talla,
          p.imagen,
          p.estado,
          p.creado_en,

          COALESCE(
            json_agg(
              json_build_object(
                'id', pt.id,
                'talla', pt.talla,
                'stock', pt.stock
              )
              ORDER BY pt.talla
            ) FILTER (WHERE pt.id IS NOT NULL),
            '[]'::json
          ) AS tallas

        FROM productos p

        LEFT JOIN producto_tallas pt
          ON pt.producto_id = p.id

        WHERE p.id = $1

        GROUP BY
          p.id,
          p.modelo,
          p.categoria,
          p.talla,
          p.imagen,
          p.estado,
          p.creado_en
      `,
      [producto.id]
    );

    return res.status(201).json({
      ok: true,
      mensaje: "Producto creado correctamente",
      producto: resultadoFinal.rows[0],
    });

  } catch (error) {
    await client.query("ROLLBACK");

    console.error("❌ Error creando producto:", error);

    return res.status(500).json({
      ok: false,
      mensaje: "Error creando el producto",
      error: error.message,
    });

  } finally {
    client.release();
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
