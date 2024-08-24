#!/usr/bin/env node


const dogecore = require('./bitcore-lib-bells')
const axios = require('axios')
const fs = require('fs')
const dotenv = require('dotenv')
const mime = require('mime-types')
const express = require('express')
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
   let cmd = process.argv[2]
   let subcmd = process.argv[3]


   if (fs.existsSync('pending-txs.json')) {
       console.log('found pending-txs.json. rebroadcasting...')
       const txs = JSON.parse(fs.readFileSync('pending-txs.json'))
       await broadcastAll(txs.map(tx => new Transaction(tx)), false)
       return
   }


   if (cmd === 'bel-20') {
     if (subcmd === 'deploy') {
       await bel20Deploy()
     } else if (subcmd === 'mint') {
       await bel20Mint()
     } else if (subcmd === 'transfer') {
       await bel20Transfer()
     } else {
       throw new Error(`unknown subcommand for bel-20: ${subcmd}`)
     }
   } else if (cmd === 'mint') {
     await mintFile()
   } else if (cmd == 'wallet') {
     await wallet()
   } else if (cmd == 'server') {
     await server()
   } else {
     throw new Error(`unknown command: ${cmd} ${subcmd}`)
   }
}


async function bel20Deploy(paramAddress, paramTicker, paramMax, paramLim) {
  console.log("BEL-20 Deploy function called with:");
  console.log("Address:", paramAddress);
  console.log("Ticker:", paramTicker);
  console.log("Max:", paramMax);
  console.log("Limit:", paramLim);

  const argAddress = paramAddress || process.argv[4]
  const argTicker = paramTicker || process.argv[5]
  const argMax = paramMax || process.argv[6]
  const argLim = paramLim || process.argv[7]

  const bel20Tx = {
    p: "bel-20",
    op: "deploy",
    tick: argTicker.toLowerCase(),
    max: argMax,
    lim: argLim
  };

  await inscribeAndBroadcast(argAddress, bel20Tx);
}


async function bel20Mint(paramAddress, paramTicker, paramAmount, paramRepeat = 1) {
  console.log("BEL-20 Mint function called with:");
  console.log("Address:", paramAddress);
  console.log("Ticker:", paramTicker);
  console.log("Amount:", paramAmount);
  console.log("Repeat:", paramRepeat);

  const argAddress = paramAddress || process.argv[4]
  const argTicker = paramTicker || process.argv[5]
  const argAmount = paramAmount || process.argv[6]
  const argRepeat = Number(paramRepeat || process.argv[7]) || 1

  const bel20Tx = {
    p: "bel-20",
    op: "mint",
    tick: argTicker.toLowerCase(),
    amt: argAmount
  };

  for (let i = 0; i < argRepeat; i++) {
    console.log(`Minting BEL-20 token... ${i + 1} of ${argRepeat}`);
    await inscribeAndBroadcast(argAddress, bel20Tx);
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

  await inscribeAndBroadcast(argToAddress, bel20Tx);
}


async function inscribeAndBroadcast(address, bel20Tx) {
  const parsedBel20Tx = JSON.stringify(bel20Tx);
  let contentType = "text/plain;charset=utf-8"
  let data = Buffer.from(parsedBel20Tx)

  console.log("Content Type:", contentType);
  console.log("Data:", parsedBel20Tx);

  let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))
  let txs = inscribe(wallet, new Address(address), contentType, data)
  await broadcastAll(txs, false)
}


async function mintFile(paramAddress, paramFilePath) {
  console.log("Mint file function called with:");
  console.log("Address:", paramAddress);
  console.log("File Path:", paramFilePath);

  const argAddress = paramAddress || process.argv[3]
  const argFilePath = paramFilePath || process.argv[4]

  if (!fs.existsSync(argFilePath)) {
    throw new Error(`File not found: ${argFilePath}`);
  }

  let contentType = mime.lookup(argFilePath) || 'application/octet-stream'
  let data = fs.readFileSync(argFilePath)

  console.log("Content Type:", contentType);
  console.log("Data length:", data.length);

  let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))
  let txs = inscribe(wallet, new Address(argAddress), contentType, data)
  await broadcastAll(txs, false)
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

	console.log('syncing utxos with bells.quark.blue api')

	let response = await axios.get(`https://bells.quark.blue/api/address/${wallet.address}/utxo`)
	wallet.utxos = response.data.map((e) => ({
		txid: e.txid,
		vout: e.vout,
		satoshis: e.value,
		script: Script(new Address(wallet.address)).toHex()
	}))

	fs.writeFileSync(WALLET_PATH, JSON.stringify(wallet, 0, 2))

	let balance = wallet.utxos.reduce((acc, curr) => acc + curr.satoshis, 0)

	console.log('balance', balance)
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


async function broadcastAll(txs, retry) {
    for (let i = 0; i < txs.length; i++) {
        console.log(`broadcasting tx ${i + 1} of ${txs.length}`)
        console.log('txid:', txs[1].hash)
 
 
        try {
            await broadcast(txs[i], retry)
        } catch (e) {
          console.log('broadcast failed', e?.response.data)
          if (e?.response?.data.error?.message?.includes("bad-txns-inputs-spent") || e?.response?.data.error?.message?.includes("already in block chain")) {
            console.log('tx already sent, skipping')
            continue;
          }
          console.log('saving pending txs to pending-txs.json')
          console.log('too long mempool reached, wait for TXID to confirm before wallet sync command')
          fs.writeFileSync('pending-txs.json', JSON.stringify(txs.slice(i).map(tx => tx.toString())))
          process.exit(1)
        }
    }
 
 
    try {
      fs.unlinkSync('pending-txs.json')
    } catch (err) {
      // ignore
    }
 
 
    if (txs.length > 1) {
      console.log('inscription complete continue to next file.')
    }
 }
 

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


function inscribe(wallet, address, contentType, data) {
  console.log("Inscribe function called with:");
  console.log("Content Type:", contentType);
  console.log("Data length:", data.length);

  let txs = []

  let privateKey = new PrivateKey(wallet.privkey)
  let publicKey = privateKey.toPublicKey()

  let parts = []
  let inscription = new Script()

  console.log("Creating regular inscription");
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
           await axios.post(process.env.NODE_RPC_URL, body, options)
           break
       } catch (e) {
           if (!retry) throw e
           let msg = e.response && e.response.data && e.response.data.error && e.response.data.error.message
           if (msg && msg.includes('too-long-mempool-chain')) {
               console.warn('retrying, too-long-mempool-chain')
               await new Promise(resolve => setTimeout(resolve, 1000));
           } else {
               throw e
           }
       }
   }


   let wallet = JSON.parse(fs.readFileSync(WALLET_PATH))


   updateWallet(wallet, tx)


   fs.writeFileSync(WALLET_PATH, JSON.stringify(wallet, 0, 2))
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


main().catch(e => {
   let reason = e.response && e.response.data && e.response.data.error && e.response.data.error.message
   console.error(reason ? e.message + ':' + reason : e.message)
})
