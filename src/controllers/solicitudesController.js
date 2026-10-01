const pool = require("../config/db");

// POST /solicitudes
const crearSolicitud = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      productos,
      nombre_cliente,
      telefono_cliente,
    } = req.body;

    if (
      !nombre_cliente?.trim() ||
      !telefono_cliente?.trim()
    ) {
      return res.status(400).json({
        ok: false,
        mensaje: "Nombre y teléfono son obligatorios",
      });
    }

    if (
      !Array.isArray(productos) ||
      productos.length === 0
    ) {
      return res.status(400).json({
        ok: false,
        mensaje: "Debes seleccionar al menos un producto",
      });
    }

    // Validar estructura recibida
    const productosNormalizados = productos.map((item) => ({
      producto_id: Number(item.producto_id),
      talla: String(item.talla ?? "").trim(),
      cantidad: Number(item.cantidad),
    }));

    const productoInvalido = productosNormalizados.some(
      (item) =>
        !Number.isInteger(item.producto_id) ||
        item.producto_id <= 0 ||
        !item.talla ||
        !Number.isInteger(item.cantidad) ||
        item.cantidad <= 0
    );

    if (productoInvalido) {
      return res.status(400).json({
        ok: false,
        mensaje:
          "Los productos, tallas o cantidades de la solicitud no son válidos",
      });
    }

    // Evitar producto + talla repetidos
    const claves = productosNormalizados.map(
      (item) => `${item.producto_id}-${item.talla}`
    );

    if (new Set(claves).size !== claves.length) {
      return res.status(400).json({
        ok: false,
        mensaje:
          "No puedes repetir la misma talla del mismo producto",
      });
    }

    await client.query("BEGIN");

    // Verificar producto, talla y stock actual.
    // IMPORTANTE: todavía NO descontamos stock.
    for (const item of productosNormalizados) {
      const resultado = await client.query(
        `
          SELECT
            p.id,
            p.modelo,
            p.estado,
            pt.talla,
            pt.stock
          FROM productos p
          INNER JOIN producto_tallas pt
            ON pt.producto_id = p.id
          WHERE p.id = $1
            AND pt.talla = $2
        `,
        [item.producto_id, item.talla]
      );

      if (resultado.rowCount === 0) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          ok: false,
          mensaje:
            "Uno de los productos o tallas seleccionadas ya no existe",
        });
      }

      const producto = resultado.rows[0];

      if (producto.estado !== "disponible") {
        await client.query("ROLLBACK");

        return res.status(409).json({
          ok: false,
          mensaje: `${producto.modelo} ya no está disponible`,
        });
      }

      if (Number(producto.stock) < item.cantidad) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          ok: false,
          mensaje:
            `No hay suficiente stock de ${producto.modelo}, talla ${item.talla}. ` +
            `Disponibles: ${producto.stock}`,
        });
      }
    }

    // Crear solicitud
    const solicitudResultado = await client.query(
      `
        INSERT INTO solicitudes
          (estado, nombre_cliente, telefono_cliente)
        VALUES
          ('pendiente', $1, $2)
        RETURNING *
      `,
      [
        nombre_cliente.trim(),
        telefono_cliente.trim(),
      ]
    );

    const solicitud = solicitudResultado.rows[0];

    // Guardar producto + talla + cantidad
    for (const item of productosNormalizados) {
      await client.query(
        `
          INSERT INTO solicitud_productos
            (
              solicitud_id,
              producto_id,
              talla,
              cantidad
            )
          VALUES
            ($1, $2, $3, $4)
        `,
        [
          solicitud.id,
          item.producto_id,
          item.talla,
          item.cantidad,
        ]
      );
    }

    await client.query("COMMIT");

    return res.status(201).json({
      ok: true,
      mensaje: "Solicitud creada correctamente",
      solicitud,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("❌ Error creando solicitud:", error);

    return res.status(500).json({
      ok: false,
      mensaje: "Error creando la solicitud",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// GET /solicitudes
// Solo administrador
const obtenerSolicitudes = async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT
        s.id,
        s.estado,
        s.nombre_cliente,
        s.telefono_cliente,
        s.creado_en,

        COALESCE(
          json_agg(
            json_build_object(
              'id', p.id,
              'modelo', p.modelo,
              'categoria', p.categoria,
              'talla', COALESCE(sp.talla, p.talla),
              'cantidad', sp.cantidad,
              'imagen', p.imagen,
              'estado', p.estado
            )
            ORDER BY sp.id
          ) FILTER (WHERE p.id IS NOT NULL),
          '[]'::json
        ) AS productos

      FROM solicitudes s

      LEFT JOIN solicitud_productos sp
        ON sp.solicitud_id = s.id

      LEFT JOIN productos p
        ON p.id = sp.producto_id

      GROUP BY
        s.id,
        s.estado,
        s.nombre_cliente,
        s.telefono_cliente,
        s.creado_en

      ORDER BY s.id DESC
    `);

    return res.status(200).json(resultado.rows);

  } catch (error) {
    console.error(
      "❌ Error obteniendo solicitudes:",
      error
    );

    return res.status(500).json({
      ok: false,
      mensaje: "Error obteniendo las solicitudes",
    });
  }
};
const aprobarSolicitud = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    await client.query("BEGIN");

    // ==========================================
    // 1. BLOQUEAR Y COMPROBAR LA SOLICITUD
    // ==========================================

    const solicitudResultado = await client.query(
      `
        SELECT *
        FROM solicitudes
        WHERE id = $1
        FOR UPDATE
      `,
      [id]
    );

    if (solicitudResultado.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        ok: false,
        mensaje: "Solicitud no encontrada",
      });
    }

    const solicitud = solicitudResultado.rows[0];

    if (solicitud.estado !== "pendiente") {
      await client.query("ROLLBACK");

      return res.status(400).json({
        ok: false,
        mensaje: "La solicitud ya fue procesada",
      });
    }

    // ==========================================
    // 2. OBTENER PRODUCTOS DE LA SOLICITUD
    // ==========================================

    const productosResultado = await client.query(
      `
        SELECT
          sp.id,
          sp.producto_id,
          sp.talla,
          sp.cantidad,
          p.modelo,
          p.estado
        FROM solicitud_productos sp

        INNER JOIN productos p
          ON p.id = sp.producto_id

        WHERE sp.solicitud_id = $1

        ORDER BY sp.producto_id, sp.talla
      `,
      [id]
    );

    if (productosResultado.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        ok: false,
        mensaje: "La solicitud no tiene productos",
      });
    }

    // ==========================================
    // 3. VALIDAR Y BLOQUEAR STOCK POR TALLA
    // ==========================================

    for (const item of productosResultado.rows) {
      /*
        Compatibilidad con solicitudes antiguas:
        las solicitudes creadas antes del sistema
        de inventario pueden tener talla NULL.
      */

      if (!item.talla) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          ok: false,
          mensaje:
            `La solicitud #${id} es anterior al nuevo sistema de stock ` +
            `y no tiene una talla de inventario asociada.`,
        });
      }

      const stockResultado = await client.query(
        `
          SELECT
            id,
            producto_id,
            talla,
            stock
          FROM producto_tallas
          WHERE producto_id = $1
            AND talla = $2
          FOR UPDATE
        `,
        [item.producto_id, item.talla]
      );

      if (stockResultado.rowCount === 0) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          ok: false,
          mensaje:
            `No existe inventario para ${item.modelo}, talla ${item.talla}.`,
        });
      }

      const inventario = stockResultado.rows[0];
      const cantidadSolicitada = Number(item.cantidad);

      if (Number(inventario.stock) < cantidadSolicitada) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          ok: false,
          mensaje:
            `Stock insuficiente para ${item.modelo}, talla ${item.talla}. ` +
            `Solicitado: ${cantidadSolicitada}. ` +
            `Disponible: ${inventario.stock}.`,
        });
      }
    }

    // ==========================================
    // 4. DESCONTAR STOCK
    // ==========================================

    for (const item of productosResultado.rows) {
      await client.query(
        `
          UPDATE producto_tallas
          SET stock = stock - $1
          WHERE producto_id = $2
            AND talla = $3
        `,
        [
          Number(item.cantidad),
          item.producto_id,
          item.talla,
        ]
      );
    }

    // ==========================================
    // 5. APROBAR SOLICITUD
    // ==========================================

    const resultado = await client.query(
      `
        UPDATE solicitudes
        SET estado = 'aprobada'
        WHERE id = $1
        RETURNING *
      `,
      [id]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      ok: true,
      mensaje: "Solicitud aprobada y stock actualizado correctamente",
      solicitud: resultado.rows[0],
    });

  } catch (error) {
    await client.query("ROLLBACK");

    console.error("❌ Error aprobando solicitud:", error);

    return res.status(500).json({
      ok: false,
      mensaje: "Error aprobando la solicitud",
      error: error.message,
    });

  } finally {
    client.release();
  }
};

const rechazarSolicitud = async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await pool.query(
      `
      UPDATE solicitudes
      SET estado = 'rechazada'
      WHERE id = $1
        AND estado = 'pendiente'
      RETURNING *
      `,
      [id],
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: "Solicitud no encontrada o ya procesada",
      });
    }

    return res.status(200).json({
      ok: true,
      mensaje: "Solicitud rechazada correctamente",
      solicitud: resultado.rows[0],
    });
  } catch (error) {
    console.error("❌ Error rechazando solicitud:", error);

    return res.status(500).json({
      ok: false,
      mensaje: "Error rechazando la solicitud",
    });
  }
};

module.exports = {
  crearSolicitud,
  obtenerSolicitudes,
  aprobarSolicitud,
  rechazarSolicitud,
};
