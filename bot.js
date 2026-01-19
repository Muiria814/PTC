import express from "express";
import { Telegraf, Markup, session } from "telegraf";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import secp256k1 from "secp256k1";

// ================== INIT ==================
console.log("🚀 Iniciando bot DogePTC...");
console.log("✅ CHEGUEI ATÉ AQUI (ANTES DO BOT)");

// 🔎 DEBUG SUPABASE
console.log("SUPABASE_URL:", !!process.env.SUPABASE_URL);
console.log("SERVICE_ROLE_KEY:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);


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
const { Telegraf, Markup } = require("telegraf");
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const mainMenu = Markup.keyboard([
  ["🚀 INICIAR", "💰 SALDO"],
  ["📺 GANHAR", "💸 LEVANTAR"]
])
  .resize()
  .persistent();

// ====== WITHDRAW REAL (DOGE MAINNET) ======

const HOUSE_ADDRESS = process.env.HOUSE_ADDRESS;
const HOUSE_PRIVATE = process.env.HOUSE_PRIVATE;
const TOKEN = process.env.BLOCKCYPHER_TOKEN;

app.post("/withdraw", async (req, res) => {
  try {

    console.log("📩 /withdraw foi chamado!", req.body);

    // ===== VALIDAR ENV =====
    if (!HOUSE_ADDRESS || !HOUSE_PRIVATE || !TOKEN) {
      return res.json({ success:false, message:"Variáveis .env em falta" });
    }

    if (HOUSE_PRIVATE.length !== 64) {
      return res.json({ success:false, message:"HOUSE_PRIVATE tem de ser chave HEX (64 chars)" });
    }

    const { userId, address, amount } = req.body;

    if (!userId || !address || !amount)
      return res.json({ success:false, message:"Dados incompletos" });

    if (amount < 0.001)
      return res.json({ success:false, message:"Mínimo 0.001 DOGE" });

    // ===== USER =====
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (!user)
      return res.json({ success:false, message:"Usuário não encontrado" });

    // ===== HOUSE =====
    const { data: house } = await supabase
      .from("users")
      .select("*")
      .eq("role","house")
      .single();

    if (!house)
      return res.json({ success:false, message:"House não encontrada" });

    if ((user.doge||0) < amount)
      return res.json({ success:false, message:"Saldo insuficiente" });

    if ((house.saldo||0) < amount)
      return res.json({ success:false, message:"House sem saldo" });

    // ===== CRIAR TX =====
    const newtx = await axios.post(
      "https://api.blockcypher.com/v1/doge/main/txs/new",
      {
        inputs:[{ addresses:[HOUSE_ADDRESS] }],
        outputs:[{ addresses:[address], value:Math.floor(amount*1e8)}]
      },
      { params:{ token:TOKEN } }
    );

    let tx = newtx.data;
    
    console.log("NEW TX:", newtx.data);
    
// ===== ASSINAR CORRETAMENTE =====
tx.signatures = [];
tx.pubkeys = [];

// criar pk a partir da private key (uma vez)
const pk = Buffer.from(HOUSE_PRIVATE, "hex");

// criar pubkey compressa (33 bytes)
const pubkey = Buffer.from(
  secp256k1.publicKeyCreate(pk, true)
).toString("hex");

tx.tosign.forEach(ts => {

  // ts já é hash pronto — não fazer SHA256 de novo
  const msg = Buffer.from(ts, "hex");

  // assinatura raw r||s
  const sigObj = secp256k1.ecdsaSign(msg, pk);

  // converter para DER
  const der = secp256k1.signatureExport(sigObj.signature);

  tx.signatures.push(Buffer.from(der).toString("hex"));
  tx.pubkeys.push(pubkey);
});
    
    // ===== ENVIAR =====
    const sent = await axios.post(
      "https://api.blockcypher.com/v1/doge/main/txs/send",
      tx,
      { params:{ token:TOKEN } }
    );

    const txHash = sent?.data?.tx?.hash;

if (!txHash) {
  console.log("BLOCKCYPHER ERROR:", sent.data);
  return res.json({
    success:false,
    message:"Falha ao enviar transação"
  });
}
    console.log("SEND RESULT:", sent.data);
    
    // ===== ATUALIZAR SALDOS =====
    await supabase.from("users")
      .update({ doge:(user.doge||0)-amount })
      .eq("id", userId);

    await supabase.from("users")
      .update({ saldo:(house.saldo||0)-amount })
      .eq("role","house");

    return res.json({ success:true, txHash });

  } catch(err) {

    console.error("WITHDRAW ERROR:", err?.response?.data || err?.message || err);

    console.log("🔥 DEBUG ERROR:", err?.response?.data, err?.message);

    return res.json({
      success:false,
      message:"Erro ao processar withdraw"
    });
  }
});


// ================== BOT COMMANDS ==================

// /start
bot.start(async ctx => {
  const telegramId = ctx.from.id;
  const name = ctx.from.first_name || "User";

  try {
    const { data: user, error: selectError } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegramId)
      .single();

    if (selectError && selectError.code !== "PGRST116") {
      console.error("/start select error:", selectError);
      return ctx.reply("⚠️ Erro ao verificar usuário.");
    }

    if (!user) {
      const { error: insertError } = await supabase
        .from("users")
        .insert([{
          telegram_id: telegramId,
          name,
          doge: 0,
          balance: 0
        }]);

      if (insertError) {
        console.error("/start insert error:", insertError);
        return ctx.reply("⚠️ Erro ao criar conta.");
      }
    }

    // ✅ RESPOSTA FINAL DO /start (COM BOTÕES)
    return ctx.reply(
      `👋 Olá ${name}!\nBem-vindo ao DogePTC 🐕`,
      mainMenu
    );

  } catch (err) {
    console.error("/start catch error:", err);
    return ctx.reply("⚠️ Erro ao iniciar o bot.");
  }
});


// 🚀 BOTÃO INICIAR
bot.hears("🚀 INICIAR", ctx => {
  ctx.reply("🤖 Bot iniciado!", mainMenu);
});


// BOTÃO GANHAR
bot.hears("📺 GANHAR", async ctx => {
  await ctx.reply(
    "📢 Assista ao anúncio para ganhar DOGE.\nClique no botão abaixo para confirmar e receber sua recompensa!",
    Markup.inlineKeyboard([
      Markup.button.callback("✅ CONFIRMAR", "confirm_reward")
    ])
  );
});

// CALLBACK DO BOTÃO
bot.action("confirm_reward", async ctx => {
  const telegramId = ctx.from.id;

  try {
    // Chama a função no Supabase para adicionar a recompensa
    const { error } = await supabase.rpc("add_balance", {
      tg_id: telegramId,
      amount: 1
    });

    if (error) throw error;

    // Responde ao usuário e desativa o botão
    await ctx.editMessageText("🎉 +1 DOGE adicionado! ✅");
  } catch (err) {
    console.error("Erro ao creditar recompensa:", err);
    await ctx.reply("⚠️ Erro ao creditar recompensa. Tente novamente mais tarde.");
  }

  // Evita que o botão fique ativo e o usuário clique várias vezes
  await ctx.answerCbQuery();
});

// 💰 BOTÃO SALDO
bot.hears("💰 SALDO", async ctx => {
  const telegramId = ctx.from.id;

  const { data } = await supabase
    .from("users")
    .select("doge")
    .eq("telegram_id", telegramId)
    .single();

  if (!data)
    return ctx.reply("❌ Usuário não encontrado.");

  ctx.reply(`💰 Saldo atual: ${data.doge} DOGE`);
});


// 💸 BOTÃO LEVANTAR
bot.hears("💸 LEVANTAR", ctx => {
  ctx.session = { step: "amount" };
  ctx.reply("💸 INTRODUZIR O MONTANTE A LEVANTAR:");
});

bot.on("text", async ctx => {
  if (!ctx.session?.step) return;

  const text = ctx.message.text;

  // PASSO 1 — MONTANTE
  if (ctx.session.step === "amount") {
    const amount = Number(text);

    if (isNaN(amount) || amount <= 0)
      return ctx.reply("❌ Valor inválido. Introduz um número válido.");

    ctx.session.amount = amount;
    ctx.session.step = "address";

    return ctx.reply("📬 INTRODUZIR O ENDEREÇO DOGE:");
  }

  // PASSO 2 - ENDEREÇO 
  if (ctx.session.step === "address") {
    ctx.session.address = text;
    ctx.session.step = "confirm";

    return ctx.reply(
      `✅ Confirmação do levantamento\n\n💰 Valor: ${ctx.session.amount} DOGE\n📬 Endereço: ${text}`,
      Markup.inlineKeyboard([
        Markup.button.callback("✅ ENVIAR", "send_withdraw")
      ])
    );
  }
});
    
bot.action("send_withdraw", async ctx => {
  await ctx.answerCbQuery();

  const telegramId = ctx.from.id;
  const { amount, address } = ctx.session;

  try {
    const { data: user } = await supabase
      .from("users")
      .select("id,doge")
      .eq("telegram_id", telegramId)
      .single();

    if (!user)
      return ctx.reply("❌ Usuário não encontrado.");

    if ((user.doge || 0) < amount)
      return ctx.reply("❌ Saldo insuficiente.");

    ctx.reply("⏳ Processando levantamento...");

    const result = await withdrawDOGE({
      userId: user.id,
      address,
      amount
    });

    if (!result.success)
      return ctx.reply(`❌ ${result.message}`);

    ctx.reply(`✅ Levantamento enviado!\nTX:\n${result.txHash}`);

    ctx.session = null;

  } catch (err) {
    console.error("SEND_WITHDRAW ERROR:", err);
    ctx.reply("⚠️ Erro ao processar levantamento.");
  }
});

 
// ================== START ==================
console.log("✅ VOU INICIAR O BOT AGORA");

bot.launch()
  .then(() => console.log("🤖 Bot Telegram ativo (polling)"))
  .catch(err => console.error("❌ Bot launch error:", err));

app.listen(PORT, () =>
  console.log(`🌐 HTTP server ativo na porta ${PORT}`)
);
