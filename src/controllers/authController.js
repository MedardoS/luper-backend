const pool = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// POST /auth/registro
const registrarAdmin = async (req, res) => {
  try {
    const { nombre, email, password } = req.body;

    if (!nombre || !email || !password) {
      return res.status(400).json({
        ok: false,
        mensaje: "Nombre, email y contraseña son obligatorios",
      });
    }

    const usuarioExistente = await pool.query(
      "SELECT id FROM usuarios WHERE email = $1",
      [email.toLowerCase()]
    );

    if (usuarioExistente.rowCount > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: "Ese correo ya está registrado",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const resultado = await pool.query(
      `
      INSERT INTO usuarios
        (nombre, email, password, rol)
      VALUES
        ($1, $2, $3, 'admin')
      RETURNING id, nombre, email, rol, creado_en
      `,
      [
        nombre.trim(),
        email.toLowerCase().trim(),
        passwordHash,
      ]
    );

    return res.status(201).json({
      ok: true,
      mensaje: "Administrador creado correctamente",
      usuario: resultado.rows[0],
    });
  } catch (error) {
    console.error("❌ Error registrando administrador:", error);

    return res.status(500).json({
      ok: false,
      mensaje: "Error registrando administrador",
    });
  }
};

// POST /auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        mensaje: "Email y contraseña son obligatorios",
      });
    }

    const resultado = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1",
      [email.toLowerCase().trim()]
    );

    if (resultado.rowCount === 0) {
      return res.status(401).json({
        ok: false,
        mensaje: "Credenciales incorrectas",
      });
    }

    const usuario = resultado.rows[0];

    const passwordCorrecta = await bcrypt.compare(
      password,
      usuario.password
    );

    if (!passwordCorrecta) {
      return res.status(401).json({
        ok: false,
        mensaje: "Credenciales incorrectas",
      });
    }

    const token = jwt.sign(
      {
        id: usuario.id,
        email: usuario.email,
        rol: usuario.rol,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "8h",
      }
    );

    return res.status(200).json({
      ok: true,
      mensaje: "Login correcto",
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
      },
    });
  } catch (error) {
    console.error("❌ Error iniciando sesión:", error);

    return res.status(500).json({
      ok: false,
      mensaje: "Error iniciando sesión",
    });
  }
};

module.exports = {
  registrarAdmin,
  login,
};