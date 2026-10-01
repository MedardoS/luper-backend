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
          (
            SELECT json_agg(
              json_build_object(
                'id', pt.id,
                'talla', pt.talla,
                'stock', pt.stock
              )
              ORDER BY pt.talla
            )
            FROM producto_tallas pt
            WHERE pt.producto_id = p.id
          ),
          '[]'::json
        ) AS tallas,

        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', pi.id,
                'imagen', pi.imagen,
                'publicId', pi.imagen_public_id,
                'orden', pi.orden
              )
              ORDER BY pi.orden
            )
            FROM producto_imagenes pi
            WHERE pi.producto_id = p.id
          ),

          CASE
            WHEN p.imagen IS NOT NULL THEN
              json_build_array(
                json_build_object(
                  'id', NULL,
                  'imagen', p.imagen,
                  'publicId', p.imagen_public_id,
                  'orden', 1
                )
              )
            ELSE '[]'::json
          END
        ) AS imagenes

      FROM productos p

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
    const { modelo, categoria, tallas, imagen, imagen_public_id, imagenes } =
      req.body;

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
      (item) => !item.talla || !Number.isInteger(item.stock) || item.stock < 0,
    );

    if (tallaInvalida) {
      return res.status(400).json({
        ok: false,
        mensaje:
          "Cada talla debe tener un nombre y un stock entero igual o mayor a 0",
      });
    }

    const nombresTallas = tallasNormalizadas.map((item) => item.talla);

    const tieneDuplicadas =
      new Set(nombresTallas).size !== nombresTallas.length;

    if (tieneDuplicadas) {
      return res.status(400).json({
        ok: false,
        mensaje: "No puedes repetir una talla en el mismo producto",
      });
    }

    // ================================
    // VALIDAR Y PREPARAR IMÁGENES
    // ================================

    const imagenesNormalizadas =
      Array.isArray(imagenes) && imagenes.length > 0
        ? imagenes.map((item, index) => ({
            imagen: String(item.imagen ?? "").trim(),
            publicId: item.publicId ? String(item.publicId).trim() : null,
            orden: index + 1,
          }))
        : imagen
          ? [
              {
                imagen: String(imagen).trim(),
                publicId: imagen_public_id || null,
                orden: 1,
              },
            ]
          : [];

    if (imagenesNormalizadas.length === 0 || imagenesNormalizadas.length > 4) {
      return res.status(400).json({
        ok: false,
        mensaje: "Debes agregar entre 1 y 4 imágenes",
      });
    }

    if (imagenesNormalizadas.some((item) => !item.imagen)) {
      return res.status(400).json({
        ok: false,
        mensaje: "Todas las imágenes deben tener una URL válida",
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
        imagenesNormalizadas[0].imagen,
        imagenesNormalizadas[0].publicId,
      ],
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
        [producto.id, item.talla, item.stock],
      );
    }
    for (const item of imagenesNormalizadas) {
      await client.query(
        `
      INSERT INTO producto_imagenes
      (
        producto_id,
        imagen,
        imagen_public_id,
        orden
      )
      VALUES ($1, $2, $3, $4)
    `,
        [producto.id, item.imagen, item.publicId, item.orden],
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
        (
          SELECT json_agg(
            json_build_object(
              'id', pt.id,
              'talla', pt.talla,
              'stock', pt.stock
            )
            ORDER BY pt.talla
          )
          FROM producto_tallas pt
          WHERE pt.producto_id = p.id
        ),
        '[]'::json
      ) AS tallas,

      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', pi.id,
              'imagen', pi.imagen,
              'publicId', pi.imagen_public_id,
              'orden', pi.orden
            )
            ORDER BY pi.orden
          )
          FROM producto_imagenes pi
          WHERE pi.producto_id = p.id
        ),
        '[]'::json
      ) AS imagenes

    FROM productos p
    WHERE p.id = $1
  `,
      [producto.id],
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

    // ================================
    // 1. BUSCAR PRODUCTO
    // ================================

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

    // ================================
    // 2. BUSCAR TODAS SUS IMÁGENES
    // ================================

    const imagenesEncontradas = await pool.query(
      `
        SELECT imagen_public_id
        FROM producto_imagenes
        WHERE producto_id = $1
        ORDER BY orden ASC
      `,
      [id],
    );

    // Set evita intentar borrar dos veces la misma imagen
    const publicIds = new Set(
      imagenesEncontradas.rows
        .map((item) => item.imagen_public_id)
        .filter(Boolean),
    );

    // Compatibilidad con productos antiguos
    if (producto.imagen_public_id) {
      publicIds.add(producto.imagen_public_id);
    }

    // ================================
    // 3. ELIMINAR PRODUCTO DE POSTGRESQL
    // ================================

    const resultado = await pool.query(
      `
        DELETE FROM productos
        WHERE id = $1
        RETURNING *
      `,
      [id],
    );

    console.log(
      "🗑️ Producto eliminado de PostgreSQL:",
      producto.modelo,
    );

    // producto_tallas y producto_imagenes
    // se eliminan automáticamente por ON DELETE CASCADE

    // ================================
    // 4. ELIMINAR IMÁGENES DE CLOUDINARY
    // ================================

    for (const publicId of publicIds) {
      try {
        console.log(
          "☁️ Eliminando imagen de Cloudinary:",
          publicId,
        );

        const resultadoCloudinary =
          await cloudinary.uploader.destroy(publicId);

        console.log(
          "☁️ Resultado Cloudinary:",
          resultadoCloudinary,
        );
      } catch (cloudinaryError) {
        console.error(
          `⚠️ No se pudo eliminar ${publicId} de Cloudinary:`,
          cloudinaryError.message,
        );
      }
    }

    // ================================
    // 5. RESPUESTA
    // ================================

    return res.status(200).json({
      ok: true,
      mensaje: "Producto e imágenes eliminados correctamente",
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
