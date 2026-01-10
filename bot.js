import express from "express";
import { Telegraf } from "telegraf";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Bot is running"));

// ===== Supabase =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ===== Bot =====
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply("Bot ativo!"));

// exemplo de polling
bot.launch();
console.log("🤖 Bot Telegram iniciado (polling ativo)");

// ===== Express listen =====
app.listen(PORT, () => console.log(`🌐 HTTP server ativo na porta ${PORT}`));

// ===== START =====
bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  const name = ctx.from.first_name;

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("telegram_id", telegramId)
    .single();

  if (!user) {
    await supabase.from("users").insert({
      telegram_id: telegramId,
      name,
      balance: 0
    });
  }

  ctx.reply(
    `👋 Olá ${name}!\n\n` +
    `Bem-vindo ao bot!\n\n` +
    `📊 /saldo – Ver saldo\n` +
    `📢 /ganhar – Ver anúncios`
  );
});

// ===== SALDO =====
bot.command("saldo", async (ctx) => {
  const telegramId = ctx.from.id;

  const { data, error } = await supabase
    .from("users")
    .select("balance")
    .eq("telegram_id", telegramId)
    .single();

  if (error || !data) {
    return ctx.reply("⚠️ Conta não encontrada.");
  }

  ctx.reply(`💰 Seu saldo: ${data.balance} USD`);
});

// ===== GANHAR =====
bot.command("ganhar", async (ctx) => {
  const telegramId = ctx.from.id;

  const { data: ad } = await supabase
    .from("ads")
    .select("*")
    .order("id", { ascending: false })
    .limit(1)
    .single();

  if (!ad) {
    return ctx.reply("⚠️ Nenhum anúncio disponível.");
  }

  await supabase.from("ad_views").insert({
    telegram_id: telegramId,
    ad_id: ad.id,
    started_at: new Date()
  });

  ctx.reply(
    `📢 Anúncio disponível\n\n` +
    `🔗 ${ad.url}\n` +
    `⏳ Aguarde ${ad.time}s\n` +
    `💵 Recompensa: ${ad.reward} USD\n\n` +
    `Depois use /confirmar`
  );
});

// ===== CONFIRMAR =====
bot.command("confirmar", async (ctx) => {
  const telegramId = ctx.from.id;

  const { data: view } = await supabase
    .from("ad_views")
    .select("*")
    .eq("telegram_id", telegramId)
    .eq("confirmed", false)
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  if (!view) {
    return ctx.reply("⚠️ Nenhum anúncio pendente.");
  }

  const elapsed =
    (Date.now() - new Date(view.started_at).getTime()) / 1000;

  const { data: ad } = await supabase
    .from("ads")
    .select("*")
    .eq("id", view.ad_id)
    .single();

  if (elapsed < ad.time) {
    return ctx.reply("⏳ Ainda não passou o tempo mínimo.");
  }

  await supabase
    .from("ad_views")
    .update({ confirmed: true })
    .eq("id", view.id);

  await supabase.rpc("add_balance", {
    tg_id: telegramId,
    amount: ad.reward
  });

  ctx.reply(`🎉 Recompensa recebida: ${ad.reward} USD`);
});

// ===== START POLLING =====
bot.launch();
console.log("🤖 Bot Telegram iniciado (polling ativo)");

// ===== GRACEFUL SHUTDOWN =====
process.on("SIGTERM", () => bot.stop("SIGTERM"));
process.on("SIGINT", () => bot.stop("SIGINT"));
