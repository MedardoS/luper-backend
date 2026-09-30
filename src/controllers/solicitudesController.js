const pool = require("../config/db");

// POST /solicitudes
const crearSolicitud = async (req, res) => {
  const client = await pool.connect();

  try {
    const { productos, nombre_cliente, telefono_cliente } = req.body;

    if (!nombre_cliente?.trim() || !telefono_cliente?.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: "Nombre y teléfono son obligatorios",
      });
    }

    if (!Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: "Debes seleccionar al menos un producto",
      });
    }

    await client.query("BEGIN");

    // Comprobar que todos existen y están disponibles
    const resultadoProductos = await client.query(
      `
      SELECT id, modelo, estado
      FROM productos
      WHERE id = ANY($1::int[])
      `,
      [productos],
    );

    if (resultadoProductos.rows.length !== productos.length) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        ok: false,
        mensaje: "Uno o más productos ya no existen",
      });
    }

    const noDisponibles = resultadoProductos.rows.filter(
      (producto) => producto.estado !== "disponible",
    );

    if (noDisponibles.length > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        ok: false,
        mensaje: "Uno o más productos ya no están disponibles",
        productos: noDisponibles,
      });
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
      [nombre_cliente.trim(), telefono_cliente.trim()],
    );

    const solicitud = solicitudResultado.rows[0];

    // Relacionar productos con solicitud
    for (const productoId of productos) {
      await client.query(
        `
        INSERT INTO solicitud_productos
          (solicitud_id, producto_id)
        VALUES
          ($1, $2)
        `,
        [solicitud.id, productoId],
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
              'talla', p.talla,
              'imagen', p.imagen,
              'estado', p.estado
            )
          ) FILTER (WHERE p.id IS NOT NULL),
          '[]'
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

    const solicitudResultado = await client.query(
      `
      SELECT *
      FROM solicitudes
      WHERE id = $1
      FOR UPDATE
      `,
      [id],
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

    const productosResultado = await client.query(
      `
      SELECT p.id, p.modelo, p.estado
      FROM productos p
      INNER JOIN solicitud_productos sp
        ON sp.producto_id = p.id
      WHERE sp.solicitud_id = $1
      FOR UPDATE
      `,
      [id],
    );

    const noDisponibles = productosResultado.rows.filter(
      (producto) => producto.estado !== "disponible",
    );

    if (noDisponibles.length > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        ok: false,
        mensaje: "Uno o más productos ya no están disponibles",
        productos: noDisponibles,
      });
    }

    await client.query(
      `
      UPDATE productos
      SET estado = 'apartado'
      WHERE id IN (
        SELECT producto_id
        FROM solicitud_productos
        WHERE solicitud_id = $1
      )
      `,
      [id],
    );

    const resultado = await client.query(
      `
      UPDATE solicitudes
      SET estado = 'aprobada'
      WHERE id = $1
      RETURNING *
      `,
      [id],
    );

    await client.query("COMMIT");

    return res.status(200).json({
      ok: true,
      mensaje: "Solicitud aprobada correctamente",
      solicitud: resultado.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("❌ Error aprobando solicitud:", error);

    return res.status(500).json({
      ok: false,
      mensaje: "Error aprobando la solicitud",
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
