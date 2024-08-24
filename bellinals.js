#!/usr/bin/env node

const dogecore = require('./bitcore-lib-bells')
const fs = require('fs')
const dotenv = require('dotenv')
const mime = require('mime-types')
const express = require('express')
const axios = require('axios')
const { PrivateKey, Address, Transaction, Script, Opcode } = dogecore
const { Hash, Signature } = dogecore.crypto

dotenv.config()

if (process.env.TESTNET == 'true') {
   dogecore.Networks.defaultNetwork = dogecore.Networks.testnet
}

if (process.env.FEE_PER_KB) {
   Transaction.FEE_PER_KB = parseInt(process.env.FEE_PER_KB)
} else {
   Transaction.FEE_PER_KB = 110000
}

const WALLET_PATH = process.env.WALLET || '.wallet.json'

async function main() {
   console.log("DEBUG: main function called");
   let cmd = process.argv[2]
   let subcmd = process.argv[3]

   if (fs.existsSync('pending-txs.json')) {
       console.log('found pending-txs.json. rebroadcasting...')
       const txs = JSON.parse(fs.readFileSync('pending-txs.json'))
       await broadcastAll(txs.map(tx => new Transaction(tx)), false)
       return
   }

   if (cmd == 'wallet') {
       await wallet()
   } else if (cmd == 'extract') {
       await extractCmd()
   } else if (cmd == 'server') {
       server()
   } else if (cmd == 'mint') {
       await mint()
   } else if (cmd == 'bellmap') {
       console.log("DEBUG: bellmap command detected");
       await mintBellmap()
   } else if (cmd == 'bel-20') {
       if (subcmd == 'mint') {
           await bel20Mint()
       } else if (subcmd == 'deploy') {
           await bel20Deploy()
       } else {
           throw new Error(`unknown bel-20 subcommand: ${subcmd}`)
       }
   } else {
       throw new Error(`unknown command: ${cmd}`)
   }
}

async function bel20Deploy() {
  console.log("BEL-20 Deploy function called");

  const argAddress = process.argv[4]
  const argTicker = process.argv[5]
  const argMax = process.argv[6]
  const argLim = process.argv[7]

  console.log(`Address: ${argAddress}`);
  console.log(`Ticker: ${argTicker}`);
  console.log(`Max: ${argMax}`);
  console.log(`Limit: ${argLim}`);

  const bel20Tx = {
    p: "bel-20",
    op: "deploy",
    tick: argTicker,
    max: argMax,
    lim: argLim
  };

  console.log('BEL-20 Deploy Transaction data:', JSON.stringify(bel20Tx, null, 2));

  const txs = await inscribeAndBroadcast(argAddress, bel20Tx);
  console.log('Deploy Transaction ID:', txs[txs.length - 1].hash);
}

process.env.NODE_NO_WARNINGS = '1';

async function getConfirmationDetails(txid) {
    const body = {
        jsonrpc: "1.0",
        id: "getconfirmationdetails",
        method: "getrawtransaction",
        params: [txid, true]
    };

    const options = {
        auth: {
            username: process.env.NODE_RPC_USER,
            password: process.env.NODE_RPC_PASS
        }
    };

    try {
        const response = await axios.post(process.env.NODE_RPC_URL, body, options);
        const txInfo = response.data.result;

        return {
            confirmations: txInfo.confirmations || 0,
            inMempool: txInfo.confirmations === 0,
            inBlock: txInfo.blockhash ? true : false,
            fees: txInfo.fees,
            size: txInfo.size
        };
    } catch (error) {
        console.error('Error getting transaction details:', error.message);
        throw error;
    }
}

async function waitForConfirmation(txid) {
    const maxAttempts = 30; // Maximum number of attempts
    let attempts = 0;

    while (attempts < maxAttempts) {
        try {
            const confirmationDetails = await getConfirmationDetails(txid);
            
            console.log(`Confirmation details for ${txid}:`);
            console.log(`  Confirmations: ${confirmationDetails.confirmations}`);
            console.log(`  In mempool: ${confirmationDetails.inMempool}`);
            console.log(`  In block: ${confirmationDetails.inBlock}`);
            if (confirmationDetails.fees) {
                console.log(`  Fees: ${confirmationDetails.fees} DOGE`);
            }
            if (confirmationDetails.size) {
                console.log(`  Transaction size: ${confirmationDetails.size} bytes`);
            }

            if (confirmationDetails.confirmations > 0) {
                console.log(`Transaction ${txid} confirmed!`);
                return;
            }

            console.log(`Waiting for confirmation... Attempt ${attempts + 1}/${maxAttempts}`);
            await new Promise(resolve => setTimeout(resolve, 20000)); // Wait 20 seconds before checking again
            attempts++;
        } catch (error) {
            console.error(`Error checking confirmation: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 20000)); // Wait 20 seconds before retrying
            attempts++;
        }
    }

    console.log(`Max attempts reached. Transaction ${txid} may still be unconfirmed.`);
}

function getRandomMintingMessage() {
  const messages = [
    "MINTING MF!",
    "Time to birth some f*cking Bellinals!",
    "Firing up the Bellscoin sh*t-printer!",
    "Inscribing digital crack for crypto junkies!",
    "Minting faster than a virgin's first time!",
    "Bellinals incoming! Hide yo kids, hide yo wife!",
    "Creating magic internet money, b*tches!",
    "Ordinals? More like Whore-dinals, amirite?",
    "Inscribing faster than your mom's OnlyFans subscribers!",
    "Minting: Because who needs real money when you can have digital dogsh*t?",
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

function getRandomMintedMessage() {
  const messages = [
    "MINTED MF!",
    "Bellinals minted! Time to get rich or die mining!",
    "Ordinals inscribed! Your digital d*ck-measuring contest starts now!",
    "Minting complete! You're now the proud owner of expensive f*cking JPEGs!",
    "Boom! Fresh Bellscoin ordinals, hot and ready to lose value!",
    "Inscriptions done! Now go brag about it like the attention whore you are!",
    "Minting mission accomplished! Time to jerk off to your blockchain explorer!",
    "Bellinals created! May the crypto gods bless your degen ass!",
    "Minting done! Your digital circle-jerk tokens are ready!",
    "Inscriptions complete! Go forth and spam Twitter with your sh*tty NFTs!",
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

let isMinting = false;

async function bel20Mint() {
  if (isMinting) {
    console.log("Minting process already in progress. Skipping duplicate execution.");
    return;
  }
  
  isMinting = true;
  console.log("Starting BEL-20 minting process");

  try {
    console.log(getRandomMintingMessage());

    // Log all arguments for debugging
    console.log('All arguments:', process.argv);

    // Find the index of 'mint' in the arguments
    const mintIndex = process.argv.indexOf('mint');
    if (mintIndex === -1 || mintIndex + 3 >= process.argv.length) {
      throw new Error('Invalid arguments for bel-20 mint');
    }

    const argAddress = process.argv[mintIndex + 1];
    let argTicker = process.argv[mintIndex + 2];
    // If argTicker is empty or undefined, default to "$bel"
    argTicker = argTicker && argTicker.trim() !== '' ? argTicker : '$bel';
    const argAmount = process.argv[mintIndex + 3];
    const argRepeat = Math.min(Number(process.argv[mintIndex + 4]) || 1, 24);

    console.log(`Address: ${argAddress}`);
    console.log(`Ticker: ${argTicker}`);
    console.log(`Amount: ${argAmount}`);
    console.log(`Repeat: ${argRepeat}`);

    console.log(`Minting ${argRepeat} times for ticker: ${argTicker}`);

    const bel20Tx = {
      p: "bel-20",
      op: "mint",
      tick: argTicker,
      amt: argAmount
    };

    console.log('BEL-20 Transaction data:', JSON.stringify(bel20Tx, null, 2));

    let allTxs = [];
    for (let i = 0; i < argRepeat; i++) {
      let wallet = JSON.parse(fs.readFileSync(WALLET_PATH));
      let txs = inscribe(wallet, new Address(argAddress), "text/plain;charset=utf-8", Buffer.from(JSON.stringify(bel20Tx)));
      allTxs = allTxs.concat(txs);
      
      // Update wallet after each mint
      for (const tx of txs) {
        updateWallet(wallet, tx);
      }
      fs.writeFileSync(WALLET_PATH, JSON.stringify(wallet, null, 2));
    }

    console.log(`Total transactions created: ${allTxs.length}`);
    console.log("Broadcasting transactions...");
    await broadcastAll(allTxs, false);  // Pass false to indicate it's a BEL-20 mint
    console.log("Broadcast complete");
    console.log(getRandomMintedMessage());
  } catch (error) {
    console.error("Error in BEL-20 minting process:", error);
  } finally {
    isMinting = false;
  }
}

async function bel20Transfer(paramFromAddress, paramToAddress, paramTicker, paramAmount) {
  console.log("BEL-20 Transfer function called with:");
  console.log("From Address:", paramFromAddress);
  console.log("To Address:", paramToAddress);
  console.log("Ticker:", paramTicker);
  console.log("Amount:", paramAmount);

  const argFromAddress = paramFromAddress || process.argv[4]
  const argToAddress = paramToAddress || process.argv[5]
  const argTicker = paramTicker || process.argv[6]
  const argAmount = paramAmount || process.argv[7]

  const bel20Tx = {
    p: "bel-20",
    op: "transfer",
    tick: argTicker.toLowerCase(),
    amt: argAmount
  };

  const txs = await inscribeAndBroadcast(argToAddress, bel20Tx);
  console.log('Genesis Transaction ID:', txs[txs.length - 1].hash);
}

async function inscribeAndBroadcast(address, bel20Tx) {
  try {
    const parsedBel20Tx = JSON.stringify(bel20Tx);
    let contentType = "text/plain;charset=utf-8"
    let data = Buffer.from(parsedBel20Tx)

    console.log("Content Type:", contentType);
    console.log("Data:", parsedBel20Tx);

    let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))
    let txs = inscribe(wallet, new Address(address), contentType, data)
    await broadcastAll(txs, false)
    return txs;
  } catch (error) {
    console.error("Error in inscribeAndBroadcast:", error.message);
    throw error;
  }
}

async function mint(paramAddress, paramFilePath) {
    console.log(getRandomMintingMessage());

    const argAddress = paramAddress || process.argv[3]
    const argFilePath = paramFilePath || process.argv[4]

    if (!fs.existsSync(argFilePath)) {
        throw new Error(`File not found: ${argFilePath}`);
    }

    let contentType = mime.contentType(mime.lookup(argFilePath))
    let data = fs.readFileSync(argFilePath)

    console.log(`Minting file: ${argFilePath}`);
    console.log(`Content type: ${contentType}`);
    console.log(`File size: ${data.length} bytes`);

    let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))
    let allTxs = inscribe(wallet, new Address(argAddress), contentType, data);
    console.log(`Total transactions generated: ${allTxs.length}`);

    // Log details of each generated transaction
    allTxs.forEach((tx, index) => {
        console.log(`Transaction ${index + 1} hash: ${tx.hash}`);
    });

    // Filter out any undefined transactions
    let validTxs = allTxs.filter(tx => tx !== undefined);
    console.log(`Valid transactions to broadcast: ${validTxs.length}`);

    if (validTxs.length < allTxs.length) {
        console.warn(`Warning: ${allTxs.length - validTxs.length} transactions were undefined and will be skipped.`);
    }

    await broadcastAll(validTxs, true);
}

async function broadcastAll(txs, retry) {
    const maxUnconfirmedTxs = 24;
    let lastGenesisTxId = null;
    let successfulMints = 0;
    let failedMints = 0;

    console.log(`Starting to broadcast ${txs.length} transactions`);

    for (let i = 0; i < txs.length; i++) {
        try {
            if (!txs[i]) {
                throw new Error(`Invalid transaction at index ${i}`);
            }
            console.log(`Broadcasting transaction ${i + 1} of ${txs.length}`);
            await broadcast(txs[i], false);
            if (i % 2 === 1) {  // This is a reveal transaction
                lastGenesisTxId = txs[i].hash;
                console.log(`Mint ${Math.floor(i/2) + 1} Genesis TX ID:`, lastGenesisTxId);
                successfulMints++;
            }
            
            // Wait for confirmation if we've reached maxUnconfirmedTxs
            if ((i + 1) % maxUnconfirmedTxs === 0 && retry) {
                console.log(`Reached ${maxUnconfirmedTxs} transactions. Waiting for confirmation of last Genesis TX ID: ${lastGenesisTxId}`);
                await waitForConfirmation(lastGenesisTxId);
            } else {
                await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
            }
        } catch (e) {
            failedMints++;
            console.error(`Failed to mint transaction ${Math.floor(i/2) + 1}. Error: ${e.message}`);
            console.error(`Transaction details: ${JSON.stringify(txs[i], null, 2)}`);
            
            if (i % 2 === 0) {
                i++;  // Skip the next transaction if this was a commit transaction
            }
        }
    }

    console.log(`Broadcast complete. Successful mints: ${successfulMints}, Failed mints: ${failedMints}`);
}

async function wallet() {
   let subcmd = process.argv[3]

   if (subcmd == 'new') {
       walletNew()
   } else if (subcmd == 'sync') {
       await walletSync()
   } else if (subcmd == 'balance') {
       walletBalance()
   } else if (subcmd == 'send') {
       await walletSend()
   } else if (subcmd == 'split') {
       await walletSplit()
   } else {
       throw new Error(`unknown subcommand: ${subcmd}`)
   }
}

function walletNew() {
   if (!fs.existsSync(WALLET_PATH)) {
       const privateKey = new PrivateKey()
       const privkey = privateKey.toWIF()
       const address = privateKey.toAddress().toString()
       const json = { privkey, address, utxos: [] }
       fs.writeFileSync(WALLET_PATH, JSON.stringify(json, 0, 2))
       console.log('address', address)
   } else {
       throw new Error('wallet already exists')
   }
}

async function walletSync() {
    if (process.env.TESTNET == 'true') throw new Error('no testnet api')

    let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))

    console.log('Syncing MF!')

    let response = await axios.get(`https://bells.quark.blue/api/address/${wallet.address}/utxo`)
    wallet.utxos = response.data.map((e) => ({
        txid: e.txid,
        vout: e.vout,
        satoshis: e.value,
        script: Script(new Address(wallet.address)).toHex()
    }))

    fs.writeFileSync(WALLET_PATH, JSON.stringify(wallet, 0, 2))

    let balance = wallet.utxos.reduce((acc, curr) => acc + curr.satoshis, 0)

    console.log("HERE'S YOUR BELLS!", balance)
}

function walletBalance() {
   let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))

   let balance = wallet.utxos.reduce((acc, curr) => acc + curr.satoshis, 0)

   console.log(wallet.address, balance)
}

async function walletSend() {
   const argAddress = process.argv[4]
   const argAmount = process.argv[5]

   let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))

   let balance = wallet.utxos.reduce((acc, curr) => acc + curr.satoshis, 0)
   if (balance == 0) throw new Error('no funds to send')

   let receiver = new Address(argAddress)
   let amount = parseInt(argAmount)

   let tx = new Transaction()
   if (amount) {
       tx.to(receiver, amount)
       fund(wallet, tx)
   } else {
       tx.from(wallet.utxos)
       tx.change(receiver)
       tx.sign(wallet.privkey)
   }

   await broadcast(tx, true)

   console.log(tx.hash)
}

async function walletSplit() {
   let splits = parseInt(process.argv[4])

   let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))

   let balance = wallet.utxos.reduce((acc, curr) => acc + curr.satoshis, 0)
   if (balance == 0) throw new Error('no funds to split')

   let tx = new Transaction()
   tx.from(wallet.utxos)
   for (let i = 0; i < splits - 1; i++) {
       tx.to(wallet.address, Math.floor(balance / splits))
   }
   tx.change(wallet.address)
   tx.sign(wallet.privkey)

   await broadcast(tx, true)

   console.log(tx.hash)
}

const MAX_SCRIPT_ELEMENT_SIZE = 520

function bufferToChunk(b, type) {
   b = Buffer.from(b, type)
   return {
       buf: b.length ? b : undefined,
       len: b.length,
       opcodenum: b.length <= 75 ? b.length : b.length <= 255 ? 76 : 77
   }
}

function numberToChunk(n) {
   return {
       buf: n <= 16 ? undefined : n < 128 ? Buffer.from([n]) : Buffer.from([n % 256, n / 256]),
       len: n <= 16 ? 0 : n < 128 ? 1 : 2,
       opcodenum: n == 0 ? 0 : n <= 16 ? 80 + n : n < 128 ? 1 : 2
   }
}

function IdToChunk(inscription_id) {
  // Only use this function for delegate inscriptions
  if (!inscription_id.endsWith('i0')) {
    throw new Error("Delegate inscription ID must end with 'i0'");
  }

  let txid = inscription_id.slice(0, -2);
  const reversedTxidBuffer = Buffer.from(txid, 'hex').reverse();

  return {
    buf: reversedTxidBuffer,
    len: 32,
    opcodenum: 32
  };
}

function opcodeToChunk(op) {
   return { opcodenum: op }
}

const MAX_CHUNK_LEN = 240
const MAX_PAYLOAD_LEN = 1500

function inscribe(wallet, address, contentType, data, delegateTxId = "") {
  let txs = []

  let privateKey = new PrivateKey(wallet.privkey)
  let publicKey = privateKey.toPublicKey()

  let parts = []
  let inscription = new Script()

  if (delegateTxId.length > 0) {
    inscription.chunks.push(bufferToChunk('ord'))
    inscription.chunks.push(numberToChunk(1))
    inscription.chunks.push(numberToChunk(0))
    inscription.chunks.push(numberToChunk(0))
    inscription.chunks.push(numberToChunk(0))
    inscription.chunks.push(numberToChunk(11))
    inscription.chunks.push(IdToChunk(delegateTxId))
  } else {
    while (data.length) {
      let part = data.slice(0, Math.min(MAX_CHUNK_LEN, data.length))
      data = data.slice(part.length)
      parts.push(part)
    }

    inscription.chunks.push(bufferToChunk('ord'))
    inscription.chunks.push(numberToChunk(parts.length))
    inscription.chunks.push(bufferToChunk(contentType))
    parts.forEach((part, n) => {
      inscription.chunks.push(numberToChunk(parts.length - n - 1))
      inscription.chunks.push(bufferToChunk(part))
    })
  }

  let p2shInput
  let lastLock
  let lastPartial

  while (inscription.chunks.length) {
    let partial = new Script()

    if (txs.length == 0) {
      partial.chunks.push(inscription.chunks.shift())
    }

    while (partial.toBuffer().length <= MAX_PAYLOAD_LEN && inscription.chunks.length) {
      partial.chunks.push(inscription.chunks.shift())
      partial.chunks.push(inscription.chunks.shift())
    }

    if (partial.toBuffer().length > MAX_PAYLOAD_LEN) {
      inscription.chunks.unshift(partial.chunks.pop())
      inscription.chunks.unshift(partial.chunks.pop())
    }

    let lock = new Script()
    lock.chunks.push(bufferToChunk(publicKey.toBuffer()))
    lock.chunks.push(opcodeToChunk(Opcode.OP_CHECKSIGVERIFY))
    partial.chunks.forEach(() => {
      lock.chunks.push(opcodeToChunk(Opcode.OP_DROP))
    })
    lock.chunks.push(opcodeToChunk(Opcode.OP_TRUE))

    let lockhash = Hash.ripemd160(Hash.sha256(lock.toBuffer()))

    let p2sh = new Script()
    p2sh.chunks.push(opcodeToChunk(Opcode.OP_HASH160))
    p2sh.chunks.push(bufferToChunk(lockhash))
    p2sh.chunks.push(opcodeToChunk(Opcode.OP_EQUAL))

    let p2shOutput = new Transaction.Output({
      script: p2sh,
      satoshis: 100000
    })

    let tx = new Transaction()
    if (p2shInput) tx.addInput(p2shInput)
    tx.addOutput(p2shOutput)
    fund(wallet, tx)

    if (p2shInput) {
      let signature = Transaction.sighash.sign(tx, privateKey, Signature.SIGHASH_ALL, 0, lastLock)
      let txsignature = Buffer.concat([signature.toBuffer(), Buffer.from([Signature.SIGHASH_ALL])])

      let unlock = new Script()
      unlock.chunks = unlock.chunks.concat(lastPartial.chunks)
      unlock.chunks.push(bufferToChunk(txsignature))
      unlock.chunks.push(bufferToChunk(lastLock.toBuffer()))
      tx.inputs[0].setScript(unlock)
    }

    updateWallet(wallet, tx)
    txs.push(tx)

    p2shInput = new Transaction.Input({
      prevTxId: tx.hash,
      outputIndex: 0,
      output: tx.outputs[0],
      script: ''
    })

    p2shInput.clearSignatures = () => {}
    p2shInput.getSignatures = () => {}

    lastLock = lock
    lastPartial = partial
  }

  let tx = new Transaction()
  tx.addInput(p2shInput)
  tx.to(address, 100000)
  fund(wallet, tx)

  let signature = Transaction.sighash.sign(tx, privateKey, Signature.SIGHASH_ALL, 0, lastLock)
  let txsignature = Buffer.concat([signature.toBuffer(), Buffer.from([Signature.SIGHASH_ALL])])

  let unlock = new Script()
  unlock.chunks = unlock.chunks.concat(lastPartial.chunks)
  unlock.chunks.push(bufferToChunk(txsignature))
  unlock.chunks.push(bufferToChunk(lastLock.toBuffer()))
  tx.inputs[0].setScript(unlock)

  updateWallet(wallet, tx)
  txs.push(tx)

  return txs
}

function fund(wallet, tx) {
   tx.change(wallet.address)
   delete tx._fee

   for (const utxo of wallet.utxos) {
       if (tx.inputs.length && tx.outputs.length && tx.inputAmount >= tx.outputAmount + tx.getFee()) {
           break
       }

       delete tx._fee
       tx.from(utxo)
       tx.change(wallet.address)
       tx.sign(wallet.privkey)
   }

   if (tx.inputAmount < tx.outputAmount + tx.getFee()) {
       throw new Error('not enough funds')
   }
}

function updateWallet(wallet, tx) {
   wallet.utxos = wallet.utxos.filter(utxo => {
       for (const input of tx.inputs) {
           if (input.prevTxId.toString('hex') == utxo.txid && input.outputIndex == utxo.vout) {
               return false
           }
       }
       return true
   })

   tx.outputs
       .forEach((output, vout) => {
           if (output.script.toAddress().toString() == wallet.address) {
               wallet.utxos.push({
                   txid: tx.hash,
                   vout,
                   script: output.script.toHex(),
                   satoshis: output.satoshis
               })
           }
       })
}

async function broadcast(tx, retry) {
   const body = {
       jsonrpc: "1.0",
       id: 0,
       method: "sendrawtransaction",
       params: [tx.toString()]
   }

   const options = {
       auth: {
           username: process.env.NODE_RPC_USER,
           password: process.env.NODE_RPC_PASS
       }
   }

   while (true) {
       try {
           const response = await axios.post(process.env.NODE_RPC_URL, body, options);
           break;
       } catch (e) {
           if (!retry) throw e;
           if (e.response && e.response.data && e.response.data.error && e.response.data.error.message) {
               let msg = e.response.data.error.message;
               if (msg.includes('too-long-mempool-chain')) {
                   await new Promise(resolve => setTimeout(resolve, 1000));
               } else {
                   throw e;
               }
           } else {
               throw e;
           }
       }
   }

   let wallet = JSON.parse(fs.readFileSync(WALLET_PATH));
   updateWallet(wallet, tx);
   fs.writeFileSync(WALLET_PATH, JSON.stringify(wallet, null, 2));
}

function chunkToNumber(chunk) {
   if (chunk.opcodenum == 0) return 0
   if (chunk.opcodenum == 1) return chunk.buf[0]
   if (chunk.opcodenum == 2) return chunk.buf[1] * 255 + chunk.buf[0]
   if (chunk.opcodenum > 80 && chunk.opcodenum <= 96) return chunk.opcodenum - 80
   return undefined
}

async function extract(txid) {
	let resp = await axios.get(`https://dogechain.info/api/v1/transaction/${txid}`)
	let transaction = resp.data.transaction
	let script = Script.fromHex(transaction.inputs[0].scriptSig.hex)
	let chunks = script.chunks

	let prefix = chunks.shift().buf.toString('utf8')
	if (prefix != 'ord') {
		throw new Error('not a doginal')
	}

	let pieces = chunkToNumber(chunks.shift())

	let contentType = chunks.shift().buf.toString('utf8')

	let data = Buffer.alloc(0)
	let remaining = pieces

	while (remaining && chunks.length) {
		let n = chunkToNumber(chunks.shift())

		if (n !== remaining - 1) {
			txid = transaction.outputs[0].spent.hash
			resp = await axios.get(`https://dogechain.info/api/v1/transaction/${txid}`)
			transaction = resp.data.transaction
			script = Script.fromHex(transaction.inputs[0].scriptSig.hex)
			chunks = script.chunks
			continue
		}

		data = Buffer.concat([data, chunks.shift().buf])
		remaining -= 1
	}

	return {
		contentType,
		data
	}
}

function server() {
	const app = express()
	const port = process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT) : 3000

	app.get('/tx/:txid', (req, res) => {
		extract(req.params.txid)
			.then((result) => {
				res.setHeader('content-type', result.contentType)
				res.send(result.data)
			})
			.catch((e) => res.send(e.message))
	})

	app.listen(port, () => {
		console.log(`Listening on port ${port}`)
		console.log()
		console.log(`Example:`)
		console.log(
			`http://localhost:${port}/tx/15f3b73df7e5c072becb1d84191843ba080734805addfccb650929719080f62e`
		)
	})
}

async function mintBellmap() {
    console.log("DEBUG: mintBellmap function called");
    const argAddress = process.argv[3]
    const start = parseInt(process.argv[4], 10)
    const end = parseInt(process.argv[5], 10) || start // If end is not provided, use start

    if (isNaN(start)) {
        throw new Error('Invalid start number for Bellmap minting')
    }

    let address = new Address(argAddress)

    console.log(`Minting Bellmap inscription${start === end ? '' : 's'} from ${start} to ${end}`)

    for (let i = start; i <= end; i++) {
        console.log(`DEBUG: Starting mint for ${i}.bellmap`);
        const data = Buffer.from(`${i}.bellmap`, 'utf8')
        const contentType = 'text/plain'

        let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))
        let txs = inscribe(wallet, address, contentType, data)
        console.log(`Minting ${i}.bellmap`)
        
        try {
            await broadcastAll(txs, false)
            console.log(`Successfully minted ${i}.bellmap - Genesis TX ID: ${txs[txs.length - 1].hash}`)
        } catch (error) {
            console.error(`Failed to mint ${i}.bellmap: ${error.message}`)
        }
        
        // Add a small delay between mints to avoid overwhelming the network
        await new Promise(resolve => setTimeout(resolve, 1000))
    }

    console.log(`Bellmap minting complete for range ${start} to ${end}`)
}

async function broadcastAll(txs, retry) {
    const maxUnconfirmedTxs = 24;
    let lastGenesisTxId = null;
    let successfulMints = 0;
    let failedMints = 0;

    console.log(`Starting to broadcast ${txs.length} transactions`);

    for (let i = 0; i < txs.length; i++) {
        try {
            if (!txs[i]) {
                throw new Error(`Invalid transaction at index ${i}`);
            }
            console.log(`Broadcasting transaction ${i + 1} of ${txs.length}`);
            await broadcast(txs[i], false);
            if (i % 2 === 1) {  // This is a reveal transaction
                lastGenesisTxId = txs[i].hash;
                console.log(`Mint ${Math.floor(i/2) + 1} Genesis TX ID:`, lastGenesisTxId);
                successfulMints++;
            }
            
            // Wait for confirmation if we've reached maxUnconfirmedTxs
            if ((i + 1) % maxUnconfirmedTxs === 0 && retry) {
                console.log(`Reached ${maxUnconfirmedTxs} transactions. Waiting for confirmation of last Genesis TX ID: ${lastGenesisTxId}`);
                await waitForConfirmation(lastGenesisTxId);
            } else {
                await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
            }
        } catch (e) {
            failedMints++;
            console.error(`Failed to mint transaction ${Math.floor(i/2) + 1}. Error: ${e.message}`);
            console.error(`Transaction details: ${JSON.stringify(txs[i], null, 2)}`);
            
            if (i % 2 === 0) {
                i++;  // Skip the next transaction if this was a commit transaction
            }
        }
    }

    console.log(`Broadcast complete. Successful mints: ${successfulMints}, Failed mints: ${failedMints}`);
}

function getRandomMintedMessage() {
    const messages = [
        "MINTED MF!",
        "Inscriptions done! Now go brag about it like the attention whore you are!",
        "Bellinals created! May the crypto gods bless your degen ass!",
        "Ordinals inscribed! Your digital d*ck-measuring contest starts now!",
        "Boom! Fresh Bellscoin ordinals, hot and ready to lose value!",
        "Bellinals minted! Time to get rich or die mining!",
        "Minting complete! You're now the proud owner of expensive f*cking JPEGs!",
        "Inscriptions complete! Go forth and spam Twitter with your sh*tty NFTs!",
        "Minting mission accomplished! Time to jerk off to your blockchain explorer!"
    ];
    return messages[Math.floor(Math.random() * messages.length)];
}

async function main() {
    console.log("DEBUG: main function called");
    let cmd = process.argv[2]
    let subcmd = process.argv[3]

    if (fs.existsSync('pending-txs.json')) {
        console.log('found pending-txs.json. rebroadcasting...')
        const txs = JSON.parse(fs.readFileSync('pending-txs.json'))
        await broadcastAll(txs.map(tx => new Transaction(tx)), false)
        return
    }

    if (cmd == 'wallet') {
        await wallet()
    } else if (cmd == 'extract') {
        await extractCmd()
    } else if (cmd == 'server') {
        server()
    } else if (cmd == 'mint') {
        await mint()
    } else if (cmd == 'bellmap') {
        console.log("DEBUG: bellmap command detected");
        await mintBellmap()
    } else if (cmd == 'bel-20') {
        if (subcmd == 'mint') {
            await bel20Mint()
        } else if (subcmd == 'deploy') {
            await bel20Deploy()
        } else {
            throw new Error(`unknown bel-20 subcommand: ${subcmd}`)
        }
    } else {
        throw new Error(`unknown command: ${cmd}`)
    }
}

console.log("DEBUG: About to call main()");
main().catch(e => {
    let reason = e.response && e.response.data && e.response.data.error && e.response.data.error.message
    console.error(reason ? e.message + ':' + reason : e.message)
})
