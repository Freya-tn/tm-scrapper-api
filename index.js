import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs/promises";
import { parsePrice, isFreyaVariantAvailable } from "./helpers.js";
const PRODUCTS_PATH = "./products.json";


const app = express();
const PORT = process.env.PORT || 4001;
dotenv.config();
app.use(cors());
const MONGO_URI = process.env.MONGO_URI;
const SHOPIFY_API_URL = process.env.SHOPIFY_API;

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

const TMStockSchema = new mongoose.Schema({}, { strict: false });
const TMStock = mongoose.model("TM-Stock", TMStockSchema, "TM-Stock");

const collectionUrls = [
  "https://tunisiamarka.com.tn/brands-18-Anua.html",
  "https://tunisiamarka.com.tn/brands-6-Cosrx-1.html",
  "https://tunisiamarka.com.tn/brands-6-Cosrx-2.html",
  "https://tunisiamarka.com.tn/brands-16-SKINBrand-1.html",
  "https://tunisiamarka.com.tn/brands-16-SKINBrand-2.html",
  "https://tunisiamarka.com.tn/brands-16-SKINBrand-3.html",
  "https://tunisiamarka.com.tn/brands-3-SomeByMi.html",
  "https://tunisiamarka.com.tn/brands-3-SomeByMi-2.html",
  "https://tunisiamarka.com.tn/brands-17-BeautyofJoseon-.html",
  "https://tunisiamarka.com.tn/brands-17-BeautyofJoseon-2.html",
  "https://tunisiamarka.com.tn/brands-20-AXIS-Y.html",
  "https://tunisiamarka.com.tn/brands-21-DrAlthea.html",
  "https://tunisiamarka.com.tn/brands-19-MEDICUBE.html",
  "https://tunisiamarka.com.tn/brands-19-MEDICUBE-2.html",
  "https://tunisiamarka.com.tn/brands-19-MEDICUBE-3.html",
  "https://tunisiamarka.com.tn/brands-19-MEDICUBE-4.html",
  "https://tunisiamarka.com.tn/brands-19-MEDICUBE-5.html",
  "https://tunisiamarka.com.tn/brands-19-MEDICUBE-6.html"
];

// --- Utilitaire pour extraire la marque depuis l'URL ---
function extractBrandName(url) {
  const match = url.match(/brands-\d+-(.+?)\.html/i);
  if (match) {
    return match[1].replace(/-/g, " ");
  }
  return "Unknown";
}

// Fonction pour extraire les liens produits d'une page collection
async function getProductLinks(url) {
  console.log(`📂 Ouverture de la collection: ${url}`);
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);
  const brand = $(".section-title h2").text().trim() || extractBrandName(url);

  const products = [];

  $(".grid-items").each((_, el) => {
    const link = $(el).find(".caption h3 a").attr("href");
    const name = $(el).find(".caption h3 a").text().trim();
    const newPrice = $(el).find(".pro-price .new-price").text().trim();

    if (link) {
      products.push({
        brand,
        name,
        url: link,
        price: newPrice,
      });
    }
  });

  console.log(`✅ ${products.length} produits trouvés pour ${brand}`);
  return products;
}

// Fonction pour checker si un produit est en stock
async function checkStock(product) {
  try {
    console.log(`🔎 Vérification stock: ${product.name}`);
    const { data } = await axios.get(product.url);
    const $ = cheerio.load(data);

    const availability = $(".pro-available .pro-instock").text().trim();
    let status = "In Stock";
    if (availability.includes("Out of stock")) {
      status = "Out of Stock";
    }

    return { ...product, status };
  } catch (err) {
    console.error(`❌ Erreur sur ${product.url}:`, err.message);
    return { ...product, status: "Error" };
  }
}

// Route par défaut
app.get("/", (req, res) => {
  res.send("🚀 API TunisiaMarka Scraper est en ligne. Essayez /stock pour voir les produits.");
});

// Route API
app.get("/stock", async (req, res) => {
  try {
    let allProducts = [];

    for (const url of collectionUrls) {
      console.log(`--- Scraping ${url} ---`);
      const products = await getProductLinks(url);

      // Vérifie stock pour chaque produit
      const results = await Promise.all(products.map(checkStock));
      allProducts.push(...results);
    }

    // Tri par marque puis nom
    allProducts.sort((a, b) => {
      if (a.brand === b.brand) return a.name.localeCompare(b.name);
      return a.brand.localeCompare(b.brand);
    });

    console.log(`📦 Total produits collectés: ${allProducts.length}`);

    // ⚡ Retour adapté pour snapshot Mongo
    res.json({
      date: new Date().toISOString(),
      total: allProducts.length,
      products: allProducts
    });
  } catch (error) {
    console.error("🔥 Erreur API:", error.message);
    res.status(500).json({ error: "Erreur lors du scraping" });
  }
});

app.get("/compare", async (req, res) => {
  try {
    // 1️⃣ Dernier snapshot TM depuis Mongo
    const lastTM = await TMStock.findOne().sort({ date: -1 });
    if (!lastTM)
      return res.status(404).json({ error: "No TM data found in MongoDB" });

    const tmList = Array.isArray(lastTM.products) ? lastTM.products : [];

    // 2️⃣ Mapping Freya (products.json)
    const mappingRaw = await fs.readFile(PRODUCTS_PATH, "utf8");
    const mappedProducts = JSON.parse(mappingRaw);

    // 3️⃣ Produits Shopify (Freya)
    const { data: shopifyProducts } = await axios.get(SHOPIFY_API_URL, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 20000,
    });

    // 4️⃣ Index Shopify
    const productById = new Map();
    const variantById = new Map();

    for (const p of shopifyProducts || []) {
      productById.set(Number(p.id), p);
      for (const v of p.variants || []) {
        variantById.set(Number(v.id), { product: p, variant: v });
      }
    }

    // 🔹 Suivi des produits TM déjà matchés
    const matchedTMNames = new Set();

    // 5️⃣ Comparaison Freya ↔ TM
    const results = mappedProducts.map((mp) => {
      const cleanFreyaName = mp.product_name.replace(/\s+/g, "").toLowerCase();

      const tm = tmList.find(
        (t) => t.name.replace(/\s+/g, "").toLowerCase() === cleanFreyaName
      );
      if (tm) matchedTMNames.add(tm.name);

      const price_tm = tm ? parsePrice(tm.price) : null;
      const available_tm = tm?.status === "In Stock";

      let sold_by_freya = false;
      let available = false;
      let price_freya = null;
      let price_freya_before_promo = null;

      const product = mp.shopify_id
        ? productById.get(Number(mp.shopify_id))
        : null;

      if (product) {
        let variant = null;
        if (mp.variant_id) {
          const hit = variantById.get(Number(mp.variant_id));
          variant = hit?.variant || null;
        } else {
          variant = product?.variants?.[0] || null;
        }

        if (variant) {
          sold_by_freya = true;
          price_freya = parsePrice(variant.price);
          price_freya_before_promo = parsePrice(
            variant.compare_at_price ?? variant.price
          );
          available = isFreyaVariantAvailable(variant);
        } else {
          sold_by_freya = true;
        }
      }

      let diff_percent = null;
      let status = "";
      if (price_tm != null && price_freya != null) {
        const diff = ((price_tm - price_freya) / price_tm) * 100;
        diff_percent = `${diff.toFixed(2)}%`;
        if (Math.abs(diff) < 1) status = "Same";
        else if (price_freya < price_tm) status = "Freya cheaper";
        else status = "TM cheaper";
      } else if (price_tm == null) {
        status = "Only on Freya";
      } else if (price_freya == null) {
        status = "Only on TM";
      }

      return {
        brand: mp.brand,
        product_name: mp.product_name,
        price_tm,
        available_tm,
        price_freya,
        price_freya_before_promo,
        diff_percent,
        status,
        sold_by_freya,
        available,
      };
    });

    // 6️⃣ Fonction pour déduire la marque depuis le nom TM
    const extractBrand = (name) => {
      if (!name) return "Unknown";
      const knownBrands = [
        "Anua",
        "COSRX",
        "SKIN1004",
        "Beauty of Joseon",
        "Some By Mi",
        "Isntree",
        "Axis-Y",
        "Tocobo",
        "Round Lab",
        "Pyunkang Yul",
        "Etude",
        "Innisfree",
        "The Ordinary",
      ];
      const lower = name.toLowerCase();
      const brand = knownBrands.find((b) =>
        lower.startsWith(b.toLowerCase())
      );
      return brand || "Unknown";
    };

    // 7️⃣ Ajouter les produits présents uniquement sur TM
    const onlyTM = tmList
      .filter((t) => !matchedTMNames.has(t.name))
      .map((t) => ({
        brand: extractBrand(t.name),
        product_name: t.name,
        price_tm: parsePrice(t.price),
        available_tm: t.status === "In Stock",
        price_freya: null,
        price_freya_before_promo: null,
        diff_percent: null,
        status: "Only on TM",
        sold_by_freya: false,
        available: false,
      }));

    // 8️⃣ Fusion finale
    const allResults = [...results, ...onlyTM];

    res.json({
      date: lastTM.date,
      total: allResults.length,
      results: allResults,
    });
  } catch (error) {
    console.error("❌ Error in /compare:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
});