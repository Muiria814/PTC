import express from "express";
import { Telegraf } from "telegraf";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import elliptic from "elliptic";
const ec = new elliptic.ec("secp256k1");

// ================== INIT ==================
console.log("🚀 Iniciando bot DogePTC...");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ================== ENV CHECK ==================
const REQUIRED_ENV = [
  "BOT_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "HOUSE_ADDRESS",
  "HOUSE_PRIVATE",
  "BLOCKCYPHER_TOKEN"
];

REQUIRED_ENV.forEach(v => {
  if (!process.env[v]) {
    console.error(`❌ ENV em falta: ${v}`);
  } else {
    console.log(`✅ ENV OK: ${v}`);
  }
});

// ================== PROTEÇÃO GLOBAL ==================
process.on("unhandledRejection", err => {
  console.error("UnhandledRejection:", err);
});
process.on("uncaughtException", err => {
  console.error("UncaughtException:", err);
});

// ================== EXPRESS ==================
app.get("/", (req, res) => res.send("🤖 DogePTC Bot Online"));

// ================== SUPABASE ==================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ================== BOT ==================
const bot = new Telegraf(process.env.BOT_TOKEN);

// ==================================================
// 🔥 FUNÇÃO INTERNA — WITHDRAW DOGE (REAL)
// ==================================================
async function withdrawDOGE({ userId, address, amount }) {
  try {
    const HOUSE_ADDRESS = process.env.HOUSE_ADDRESS;
    const HOUSE_PRIVATE = process.env.HOUSE_PRIVATE;
    const TOKEN = process.env.BLOCKCYPHER_TOKEN;

    if (!HOUSE_ADDRESS || !HOUSE_PRIVATE || !TOKEN)
      throw new Error("Configuração incompleta");

    if (HOUSE_PRIVATE.length !== 64)
      throw new Error("HOUSE_PRIVATE inválida");

    if (amount < 0.001)
      throw new Error("Mínimo 0.001 DOGE");

    // ===== USER =====
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (!user) throw new Error("Usuário não encontrado");

    // ===== HOUSE =====
    const { data: house } = await supabase
      .from("users")
      .select("*")
      .eq("role", "house")
      .single();

    if (!house) throw new Error("House não encontrada");

    if ((user.doge || 0) < amount)
      throw new Error("Saldo insuficiente");

    if ((house.saldo || 0) < amount)
      throw new Error("House sem saldo");

    // ===== BLOCKCYPHER TX =====
    const newtx = await axios.post(
      "https://api.blockcypher.com/v1/doge/main/txs/new",
      {
        inputs: [{ addresses: [HOUSE_ADDRESS] }],
        outputs: [{ addresses: [address], value: Math.floor(amount * 1e8) }]
      },
      { params: { token: TOKEN } }
    );

    let tx = newtx.data;
    tx.signatures = [];
    tx.pubkeys = [];

    const pk = Buffer.from(HOUSE_PRIVATE, "hex");
    const pubkey = Buffer.from(
      secp256k1.publicKeyCreate(pk, true)
    ).toString("hex");

    tx.tosign.forEach(ts => {
      const sig = secp256k1.ecdsaSign(Buffer.from(ts, "hex"), pk);
      const der = secp256k1.signatureExport(sig.signature);
      tx.signatures.push(Buffer.from(der).toString("hex"));
      tx.pubkeys.push(pubkey);
    });

    const sent = await axios.post(
      "https://api.blockcypher.com/v1/doge/main/txs/send",
      tx,
      { params: { token: TOKEN } }
    );

    const txHash = sent?.data?.tx?.hash;
    if (!txHash) throw new Error("Falha ao enviar transação");

    // ===== UPDATE SALDOS =====
    await supabase.from("users")
      .update({ doge: (user.doge || 0) - amount })
      .eq("id", userId);

    await supabase.from("users")
      .update({ saldo: (house.saldo || 0) - amount })
      .eq("role", "house");

    return { success: true, txHash };

  } catch (err) {
    console.error("❌ WITHDRAW ERROR:", err.message);
    return { success: false, message: err.message };
  }
}

// ================== BOT COMMANDS ==================

// /start
bot.start(async ctx => {
  const telegramId = ctx.from.id;
  const name = ctx.from.first_name || "User";

  try {
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("telegram_id", telegramId)
      .single();

    if (!user) {
      await supabase.from("users").insert([{
        telegram_id: telegramId,
        name,
        balance: 0,
        doge: 0
      }]);
    }

    ctx.reply(`👋 Olá ${name}!\nBem-vindo ao DogePTC 🐕`);

  } catch (err) {
    console.error("/start error:", err);
    ctx.reply("⚠️ Erro ao iniciar conta.");
  }
});

// /saldo
bot.command("saldo", async ctx => {
  const telegramId = ctx.from.id;

  try {
    const { data } = await supabase
      .from("users")
      .select("doge")
      .eq("telegram_id", telegramId)
      .single();

    if (!data) return ctx.reply("❌ Usuário não encontrado.");

    ctx.reply(`💰 Saldo atual: ${data.doge} DOGE`);
  } catch (err) {
    ctx.reply("⚠️ Erro ao consultar saldo.");
  }
});

// /ganhar
bot.command("ganhar", ctx => {
  ctx.reply("📢 Anúncio disponível!\nDepois use /confirmar");
});

// /confirmar
bot.command("confirmar", async ctx => {
  const telegramId = ctx.from.id;

  try {
    const { error } = await supabase.rpc("add_balance", {
      tg_id: telegramId,
      amount: 1
    });

    if (error) throw error;

    ctx.reply("🎉 +1 DOGE adicionado!");
  } catch (err) {
    console.error("/confirmar error:", err);
    ctx.reply("⚠️ Erro ao creditar recompensa.");
  }
});

// /levantar (simples)
bot.command("levantar", async ctx => {
  const telegramId = ctx.from.id;

  const { data: user } = await supabase
    .from("users")
    .select("id,doge")
    .eq("telegram_id", telegramId)
    .single();

  if (!user)
    return ctx.reply("❌ Usuário não encontrado.");

  // ⚠️ EXEMPLO FIXO (depois tornamos interativo)
  const address = "DXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
  const amount = 1;

  ctx.reply("⏳ Processando levantamento...");

  const result = await withdrawDOGE({
    userId: user.id,
    address,
    amount
  });

  if (!result.success)
    return ctx.reply(`❌ ${result.message}`);

  ctx.reply(`✅ Levantamento enviado!\nTX:\n${result.txHash}`);
});

// ================== START ==================
bot.launch()
  .then(() => console.log("🤖 Bot Telegram ativo (polling)"))
  .catch(err => console.error("❌ Bot launch error:", err));

app.listen(PORT, () =>
  console.log(`🌐 HTTP server ativo na porta ${PORT}`)
);
