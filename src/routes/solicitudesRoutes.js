const express = require("express");

const {
  crearSolicitud,
  obtenerSolicitudes,
  aprobarSolicitud,
  rechazarSolicitud,
} = require("../controllers/solicitudesController");

const verificarToken =
  require("../middleware/auth");

const router = express.Router();

// COMPRADOR
// Crear una solicitud
router.post("/", crearSolicitud);

// ADMINISTRADOR
// Ver todas las solicitudes
router.get(
  "/",
  verificarToken,
  obtenerSolicitudes
);

// Aprobar solicitud
router.put(
  "/:id/aprobar",
  verificarToken,
  aprobarSolicitud
);

// Rechazar solicitud
router.put(
  "/:id/rechazar",
  verificarToken,
  rechazarSolicitud
);

module.exports = router;