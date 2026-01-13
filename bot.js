import express from "express";
import { Telegraf } from "telegraf";
import { createClient } from "@supabase/supabase-js";

console.log("🚀 Iniciando bot e servidor...");

// ===== Verifica variáveis de ambiente =====
const REQUIRED_ENV = ["BOT_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
REQUIRED_ENV.forEach((v) => {
  if (!process.env[v]) {
    console.error(`❌ Variável de ambiente ${v} não encontrada!`);
  } else {
    console.log(`✅ Variável ${v} encontrada`);
  }
});

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Proteção global contra crashes =====
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

try {
  // ===== Express mínimo =====
  app.get("/", (req, res) => res.send("Bot is running"));

  // ===== Supabase =====
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // ===== Bot =====
  const bot = new Telegraf(process.env.BOT_TOKEN);

  // ===== Comandos do bot =====

  // START
bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  const name = ctx.from.first_name || "User";

  try {
    // Verificar se já existe
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("telegram_id", telegramId)
      .single();

    // Se não existir, criar
    if (!user) {
      await supabase.from("users").insert([
        {
          telegram_id: telegramId,
          name: name,
          balance: 0
        }
      ]);
    }

    ctx.reply(`👋 Olá ${name}! Bem-vindo ao DogePTC 🐕`);

  } catch (err) {
    console.error("Erro no /start:", err);
    ctx.reply("⚠️ Erro ao iniciar sua conta.");
  }
});

  // SALDO
  bot.command("saldo", async (ctx) => {
    const telegramId = ctx.from.id;

    try {
      const { data, error } = await supabase
        .from("users")
        .select("balance")
        .eq("telegram_id", telegramId)
        .single();

      if (error || !data) return ctx.reply("⚠️ Usuário não encontrado.");

      ctx.reply(`💰 Seu saldo: ${data.balance} USD`);
    } catch (err) {
      console.error("Erro no comando /saldo:", err);
      ctx.reply("⚠️ Ocorreu um erro ao consultar seu saldo.");
    }
  });

  // GANHAR
  bot.command("ganhar", async (ctx) => {
    ctx.reply(`📢 Anúncio disponível! Use /confirmar após ver.`);
  });

  // CONFIRMAR
  bot.command("confirmar", async (ctx) => {
    const telegramId = ctx.from.id;

    try {
      const { error } = await supabase.rpc("add_balance", {
        tg_id: telegramId,
        amount: 1, // valor de exemplo
      });

      if (error) {
        console.error("Erro RPC add_balance:", error);
        return ctx.reply("⚠️ Erro ao confirmar anúncio.");
      }

      ctx.reply("🎉 Recompensa recebida!");
    } catch (err) {
      console.error("Erro no comando /confirmar:", err);
      ctx.reply("⚠️ Erro ao processar sua recompensa.");
    }
  });

  // ===== Inicia polling =====
  bot.launch()
    .then(() => console.log("🤖 Bot Telegram iniciado (polling ativo)"))
    .catch((err) => console.error("❌ Erro ao iniciar bot:", err));

  // ===== Express listen =====
  app.listen(PORT, () => console.log(`🌐 HTTP server ativo na porta ${PORT}`));

} catch (err) {
  console.error("❌ Erro crítico ao iniciar o servidor:", err);
                         }
