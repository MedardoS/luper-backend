const jwt = require("jsonwebtoken");

const verificarToken = (req, res, next) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization) {
      return res.status(401).json({
        ok: false,
        mensaje: "Token requerido",
      });
    }

    const partes = authorization.split(" ");

    if (
      partes.length !== 2 ||
      partes[0] !== "Bearer"
    ) {
      return res.status(401).json({
        ok: false,
        mensaje: "Formato de token inválido",
      });
    }

    const token = partes[1];

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    if (decoded.rol !== "admin") {
      return res.status(403).json({
        ok: false,
        mensaje: "Acceso solo para administradores",
      });
    }

    req.usuario = decoded;

    next();
  } catch (error) {
    console.error(
      "❌ Error verificando token:",
      error.message
    );

    return res.status(401).json({
      ok: false,
      mensaje: "Token inválido o expirado",
    });
  }
};

module.exports = verificarToken;