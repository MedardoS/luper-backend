const express = require("express");

const upload = require("../middleware/upload");
const verificarToken = require("../middleware/auth");

const {
  subirImagen,
} = require("../controllers/uploadController");

const router = express.Router();

router.post(
  "/",
  verificarToken,
  upload.single("imagen"),
  subirImagen
);

module.exports = router;