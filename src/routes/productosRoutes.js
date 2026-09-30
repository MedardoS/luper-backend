const express = require("express");

const {
  obtenerProductos,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
} = require("../controllers/productosController");

const verificarToken = require("../middleware/auth");

const router = express.Router();

// Público: los compradores necesitan ver productos
router.get("/", obtenerProductos);

// Solo administrador
router.post("/", verificarToken, crearProducto);

router.put(
  "/:id",
  verificarToken,
  actualizarProducto
);

router.delete(
  "/:id",
  verificarToken,
  eliminarProducto
);

module.exports = router;