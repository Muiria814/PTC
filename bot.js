import express from "express";
import { Telegraf } from "telegraf";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3000;

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
  const name = ctx.from.first_name;

  // Responde ao usuário
  ctx.reply(`👋 Olá ${name}! Bem-vindo ao bot!`);
});

// SALDO
bot.command("saldo", async (ctx) => {
  const telegramId = ctx.from.id;

  const { data, error } = await supabase
    .from("users")
    .select("balance")
    .eq("telegram_id", telegramId)
    .single();

  if (error || !data) return ctx.reply("⚠️ Usuário não encontrado.");

  ctx.reply(`💰 Seu saldo: ${data.balance} USD`);
});

// GANHAR
bot.command("ganhar", async (ctx) => {
  const telegramId = ctx.from.id;

  // Aqui podes simular anúncios ou pegar da tabela "ads" na supabase
  ctx.reply(`📢 Anúncio disponível! Use /confirmar após ver.`);
});

// CONFIRMAR
bot.command("confirmar", async (ctx) => {
  const telegramId = ctx.from.id;

  // Exemplo de atualizar saldo usando RPC
  const { error } = await supabase.rpc("add_balance", {
    tg_id: telegramId,
    amount: 1  // valor de exemplo
  });

  if (error) return ctx.reply("⚠️ Erro ao confirmar anúncio.");

  ctx.reply("🎉 Recompensa recebida!");
});

// ===== Proteção contra crash =====
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

// ===== Inicia polling =====
bot.launch();
console.log("🤖 Bot Telegram iniciado (polling ativo)");

// ===== Express listen =====
app.listen(PORT, () => console.log(`🌐 HTTP server ativo na porta ${PORT}`));
