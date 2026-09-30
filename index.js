const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./src/config/db");

const productosRoutes = require("./src/routes/productosRoutes");
const uploadRoutes = require("./src/routes/uploadRoutes");
const authRoutes = require("./src/routes/authRoutes");
const solicitudesRoutes = require("./src/routes/solicitudesRoutes");

const app = express();

/* MIDDLEWARES */

app.use(cors());
app.use(express.json());

/* RUTAS */

app.use("/productos", productosRoutes);
app.use("/upload", uploadRoutes);
app.use("/auth", authRoutes);
app.use("/solicitudes", solicitudesRoutes);

/* PRUEBA API + POSTGRESQL */

app.get("/", async (req, res) => {
  try {
    const resultado = await pool.query("SELECT NOW()");

    res.status(200).json({
      ok: true,
      mensaje: "🔥 API LUPER funcionando",
      postgres: "conectado",
      fechaDB: resultado.rows[0].now,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      mensaje: "Error conectando con PostgreSQL",
    });
  }
});

/* SERVIDOR */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🔥 LUPER API funcionando en puerto ${PORT}`);
});