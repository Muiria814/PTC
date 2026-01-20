import express from "express";
import { Telegraf, Markup, session } from "telegraf";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import secp256k1 from "secp256k1";

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

// ================== SUPABASE ==================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ================== BOT ==================
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

// ====== FUNÇÕES AUXILIARES ======

async function getUserByTelegramId(telegramId) {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegramId)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      console.error("Erro ao buscar usuário:", error);
      return null;
    }
    
    return data;
  } catch (err) {
    console.error("Erro em getUserByTelegramId:", err);
    return null;
  }
}

async function withdrawDOGE({ userId, address, amount }) {
  try {
    const baseURL = process.env.NODE_ENV === 'production' 
      ? process.env.BASE_URL || `http://localhost:${PORT}`
      : `http://localhost:${PORT}`;
    
    const response = await axios.post(
      `${baseURL}/withdraw`,
      { userId, address, amount }
    );
    
    return response.data;
  } catch (error) {
    console.error("❌ Withdraw function error:", error?.response?.data || error.message);
    return { 
      success: false, 
      message: error?.response?.data?.message || "Erro interno ao processar levantamento" 
    };
  }
}

// ====== ENDPOINT DE WITHDRAW ======
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

    if (amount <1)
      return res.json({ success:false, message:"Mínimo 1 DOGE" });

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

    const pk = Buffer.from(HOUSE_PRIVATE, "hex");
    const pubkey = Buffer.from(
      secp256k1.publicKeyCreate(pk, true)
    ).toString("hex");

    tx.tosign.forEach(ts => {
      const msg = Buffer.from(ts, "hex");
      const sigObj = secp256k1.ecdsaSign(msg, pk);
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
    // Verificar se usuário já existe
    let user = await getUserByTelegramId(telegramId);

    if (!user) {
      // Criar novo usuário
      const { data, error } = await supabase
        .from("users")
        .insert([{
          telegram_id: telegramId,
          name: name,
          doge: 0,
          role: 'user'
        }])
        .select()
        .single();

      if (error) {
        console.error("/start insert error:", error);
        return ctx.reply("⚠️ Erro ao criar conta.");
      }
      
      user = data;
      console.log(`✅ Novo usuário criado: ${name} (ID: ${user.id})`);
    }

    return ctx.reply(
      `👋 Olá ${name}!\nBem-vindo ao DogePTC 🐕\n\n💰 Seu saldo: ${user.doge || 0} DOGE`,
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


// BOTÃO GANHAR
bot.hears("📺 GANHAR", async ctx => {
  const telegramId = ctx.from.id;
  
  // Verificar se usuário existe
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    return ctx.reply("❌ Você precisa usar /start primeiro.");
  }

  try {
    // Buscar um anúncio aleatório que o usuário ainda não viu
    const { data: ads } = await supabase
      .from("ads")
      .select("*")
      .eq("active", true)
      .order("reward", { ascending: false })
      .limit(1);

    if (!ads || ads.length === 0) {
      return ctx.reply("📭 Nenhum anúncio disponível no momento. Volte mais tarde!");
    }

    const ad = ads[0];
    
    // Verificar se usuário já viu este anúncio
    const { data: existingView } = await supabase
      .from("ad_views")
      .select("*")
      .eq("user_id", user.id)
      .eq("ad_id", ad.id)
      .single();

    if (existingView) {
      return ctx.reply("❌ Você já visualizou este anúncio. Volte mais tarde para novos anúncios!");
    }

    // Salvar o ad_id na sessão para verificação posterior
    ctx.session = ctx.session || {};
    ctx.session.pendingAd = {
      adId: ad.id,
      userId: user.id,
      reward: 0.1  // ALTERADO: SEMPRE 0.1 DOGE
    };

    await ctx.reply(
      `📺 **${ad.title}**\n\n💰 Recompensa: 0.1 DOGE\n\nPara confirmar que assistiu, clique no botão abaixo:`,  // ALTERADO
      Markup.inlineKeyboard([
        Markup.button.callback("✅ CONFIRMAR VISUALIZAÇÃO", "confirm_reward")
      ])
    );

  } catch (err) {
    console.error("Erro ao buscar anúncio:", err);
    await ctx.reply("⚠️ Erro ao carregar anúncios. Tente novamente mais tarde.");
  }
});

// CALLBACK DO BOTÃO DE CONFIRMAÇÃO
bot.action("confirm_reward", async ctx => {
  const telegramId = ctx.from.id;
  
  if (!ctx.session || !ctx.session.pendingAd) {
    await ctx.answerCbQuery();
    return ctx.editMessageText("❌ Sessão expirada. Clique em GANHAR novamente.");
  }

  const { adId, userId, reward } = ctx.session.pendingAd;

  try {
    // Verificar novamente se não visualizou
    const { data: existingView } = await supabase
      .from("ad_views")
      .select("*")
      .eq("user_id", userId)
      .eq("ad_id", adId)
      .single();

    if (existingView) {
      await ctx.answerCbQuery();
      return ctx.editMessageText("❌ Você já recebeu a recompensa por este anúncio!");
    }

    // Registrar a visualização
    const { error: viewError } = await supabase
      .from("ad_views")
      .insert([{
        user_id: userId,
        ad_id: adId,
        viewed_at: new Date().toISOString()
      }]);

    if (viewError) throw viewError;

    // Adicionar o saldo usando a função RPC
    const { error: balanceError } = await supabase.rpc("add_balance", {
      tg_id: telegramId,
      amount: 0.1 
    });

    if (balanceError) {
      // Fallback: atualizar manualmente
      const user = await getUserByTelegramId(telegramId);
      if (user) {
        await supabase
          .from("users")
          .update({ 
            doge: (user.doge || 0) + 0.1,  // 
             
          })
          .eq("id", user.id);
      }
    }

    // Limpar sessão
    ctx.session.pendingAd = null;

    await ctx.answerCbQuery();
    await ctx.editMessageText(`🎉 Recompensa de 0.1 DOGE adicionada! ✅\n\n💰 Seu saldo foi atualizado.`); 

  } catch (err) {
    console.error("Erro ao creditar recompensa:", err);
    await ctx.answerCbQuery();
    await ctx.editMessageText("⚠️ Erro ao creditar recompensa. Tente novamente mais tarde.");
  }
});


// 💸 BOTÃO LEVANTAR
bot.hears("💸 LEVANTAR", async ctx => {
  const telegramId = ctx.from.id;
  
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    return ctx.reply("❌ Usuário não encontrado. Use /start primeiro.");
  }

  if ((user.doge || 0) < 1) {
    return ctx.reply("❌ Saldo insuficiente. Mínimo 1 DOGE para levantar.");
  }

  ctx.session = ctx.session || {};
  ctx.session.withdrawUser = user;
  ctx.session.step = "amount";
  
  ctx.reply(`💸 Seu saldo: ${user.doge} DOGE\n\nDigite o valor que deseja levantar (mínimo 1 DOGE):`);
});

bot.on("text", async ctx => {
  if (!ctx.session || !ctx.session.step) return;

  const text = ctx.message.text;

  // PASSO 1 — MONTANTE
  if (ctx.session.step === "amount") {
    const amount = parseFloat(text);

    if (isNaN(amount) || amount <= 0 || amount < 0.001) {
      return ctx.reply("❌ Valor inválido. Mínimo 1 DOGE. Digite um número válido:");
    }

    const user = ctx.session.withdrawUser;
    if ((user.doge || 0) < amount) {
      return ctx.reply(`❌ Saldo insuficiente. Seu saldo: ${user.doge} DOGE\nDigite um valor menor:`);
    }

    ctx.session.amount = amount;
    ctx.session.step = "address";

    return ctx.reply("📬 Digite seu endereço DOGE para receber os fundos:");
  }

  // PASSO 2 - ENDEREÇO 
  if (ctx.session.step === "address") {
    if (!text || text.length < 26 || !text.startsWith('D')) {
      return ctx.reply("❌ Endereço DOGE inválido. Certifique-se de que começa com 'D' e tem pelo menos 26 caracteres.\nDigite novamente:");
    }

    ctx.session.address = text;
    ctx.session.step = "confirm";

    return ctx.reply(
      `✅ Confirmação do levantamento:\n\n💰 Valor: ${ctx.session.amount} DOGE\n📬 Endereço: ${text}\n\nTaxa de rede: 0.001 DOGE (aprox.)`,
      Markup.inlineKeyboard([
        Markup.button.callback("✅ CONFIRMAR E ENVIAR", "send_withdraw"),
        Markup.button.callback("❌ CANCELAR", "cancel_withdraw")
      ])
    );
  }
});

// Handler para cancelar withdraw
bot.action("cancel_withdraw", async ctx => {
  ctx.session = null;
  await ctx.answerCbQuery();
  await ctx.editMessageText("❌ Levantamento cancelado.");
});

bot.action("send_withdraw", async ctx => {
  await ctx.answerCbQuery();

  const { amount, address, withdrawUser } = ctx.session || {};

  if (!amount || !address || !withdrawUser) {
    return ctx.editMessageText("❌ Dados da sessão perdidos. Tente novamente.");
  }

  try {
    await ctx.editMessageText("⏳ Processando levantamento...");

    const result = await withdrawDOGE({
      userId: withdrawUser.id,
      address,
      amount
    });

    if (!result.success) {
      return ctx.reply(`❌ Erro: ${result.message}`);
    }

    await ctx.reply(`✅ Levantamento enviado com sucesso!\n\n💰 Valor: ${amount} DOGE\n📬 Para: ${address}\n🔗 TX Hash: ${result.txHash}\n\nO saldo será debitado da sua conta em instantes.`);

    ctx.session = null;

  } catch (err) {
    console.error("SEND_WITHDRAW ERROR:", err);
    ctx.reply("⚠️ Erro ao processar levantamento. Tente novamente mais tarde.");
  }
});

// ================== START ==================
console.log("✅ Iniciando bot...");

bot.launch()
  .then(() => console.log("🤖 Bot Telegram ativo (polling)"))
  .catch(err => console.error("❌ Bot launch error:", err));

app.listen(PORT, () =>
  console.log(`🌐 HTTP server ativo na porta ${PORT}`)
);

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));