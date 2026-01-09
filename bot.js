import express from "express";
import { Telegraf } from "telegraf";
import axios from "axios";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BACKEND = process.env.BACKEND_URL;
const REPLIT_URL = process.env.REPLIT_URL; // https://ptc--MUIRIA.replit.app

if (!BOT_TOKEN || !BACKEND || !REPLIT_URL) {
  console.error("❌ Variáveis de ambiente em falta: BOT_TOKEN, BACKEND_URL, REPLIT_URL");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ===== START =====
bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  const name = ctx.from.first_name;

  try {
    await axios.post(`${BACKEND}/telegram/register`, { telegramId, name });
  } catch (err) {
    console.error("Erro ao registrar usuário:", err.message);
  }

  ctx.reply(
    `👋 Olá ${name}!\nBem-vindo ao bot oficial!\nUse /saldo para ver seu saldo\nUse /ganhar para ver anúncios`
  );
});

// ===== SALDO =====
bot.command("saldo", async (ctx) => {
  const telegramId = ctx.from.id;

  try {
    const res = await axios.get(`${BACKEND}/telegram/saldo/${telegramId}`);

    if (!res.data.success) return ctx.reply("⚠️ Você ainda não tem conta.");

    ctx.reply(`💰 Seu saldo: ${res.data.saldo} USD`);
  } catch (err) {
    console.error("Erro ao consultar saldo:", err.message);
    ctx.reply("⚠️ Ocorreu um erro ao consultar o saldo.");
  }
});

// ===== GANHAR ANÚNCIOS =====
bot.command("ganhar", async (ctx) => {
  const telegramId = ctx.from.id;

  try {
    const res = await axios.get(`${BACKEND}/telegram/anuncios/${telegramId}`);

    if (!res.data.success || !res.data.ad) {
      return ctx.reply("⚠️ Nenhum anúncio disponível agora. Tente mais tarde.");
    }

    const ad = res.data.ad;
    ctx.reply(
      `📢 Anúncio disponível!\n🔗 ${ad.url}\n⏳ Tempo: ${ad.time}s\n💵 Recompensa: ${ad.reward} USD\nUse /confirmar depois de ver.`
    );
  } catch (err) {
    console.error("Erro ao buscar anúncios:", err.message);
    ctx.reply("⚠️ Ocorreu um erro ao buscar anúncios.");
  }
});

// ===== CONFIRMAR VISUALIZAÇÃO =====
bot.command("confirmar", async (ctx) => {
  const telegramId = ctx.from.id;

  try {
    const res = await axios.post(`${BACKEND}/telegram/confirmar`, { telegramId });

    if (!res.data.success) {
      return ctx.reply("⚠️ Ainda não passou o tempo ou você já recebeu a recompensa.");
    }

    ctx.reply(`🎉 Recompensa recebida: ${res.data.reward} USD`);
  } catch (err) {
    console.error("Erro ao confirmar anúncio:", err.message);
    ctx.reply("⚠️ Ocorreu um erro ao confirmar a visualização.");
  }
});

// ===== WEBHOOK =====
const webhookPath = `/webhook/${BOT_TOKEN}`;
app.use(bot.webhookCallback(webhookPath));

// Configura o webhook no Telegram
(async () => {
  try {
    const url = `${REPLIT_URL}${webhookPath}`;
    await bot.telegram.setWebhook(url);
    console.log("✅ Webhook configurado em:", url);
  } catch (err) {
    console.error("❌ Erro ao configurar webhook:", err);
  }
})();

// ===== SERVIDOR =====
app.get("/", (req, res) => res.send("Bot is running"));
app.listen(PORT, () => {
  console.log("🌐 HTTP server ativo na porta", PORT);
});

// ===== PROTEÇÃO CONTRA CRASH =====
process.on("unhandledRejection", (err) => console.error("❌ Unhandled Rejection:", err));
process.on("uncaughtException", (err) => console.error("❌ Uncaught Exception:", err));
