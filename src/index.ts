import { Command } from 'commander';
import ethers from 'ethers';
import { FlashbotsBundleProvider, FlashbotsBundleResolution, FlashbotsTransactionResponse, RelayResponseError, SimulationResponseSuccess } from '@flashbots/ethers-provider-bundle';
import express from 'express';
import ganache from 'ganache';
import readline from 'readline';
import cors from "cors";

const program = new Command();
program
  .option('-r --rpc <url>', 'RPC URL to proxy to', 'http://localhost:8545/')
  .option('-p --port <number>', 'Port number to listen on', '9545');

program.parse(process.argv);

const options = program.opts();

const GANACHE_CONFIG = {
  fork: {
    url: options.rpc,
  },
  miner: {
    blockTime: 1
  },
  logging: {
    logger: {
      log: () => {}
    }
  }
}

let ac = new AbortController();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const provider = new ethers.providers.JsonRpcProvider({ url: options.rpc });
const authSigner = new ethers.Wallet(ethers.utils.randomBytes(32));

function isRelayResponseError(r: FlashbotsTransactionResponse | SimulationResponseSuccess | RelayResponseError): r is RelayResponseError {
  return (r as any)?.error !== undefined;
}

class BundleProxy {
  baseProvider: ethers.providers.JsonRpcProvider;
  provider: ethers.providers.JsonRpcProvider;
  bundle: ethers.Transaction[]|undefined;

  constructor(provider: ethers.providers.JsonRpcProvider) {
    this.baseProvider = provider;
    this.provider = provider;
  }

  async rpcHandler(method: string, params: any): Promise<any> {
    switch(method) {
    case 'eth_sendRawTransaction':
      return this.transactionHandler(params as any[]);
    default:
      return this.provider.send(method, params);
    }
  }

  private async transactionHandler(params: any[]) {
    const tx = ethers.utils.parseTransaction(params[0] as string);
    const bundle = await this.getBundle();
    for(let i = bundle.length - 1; i >= 0; i--) {
      if(bundle[i].from === tx.from && bundle[i].nonce === tx.nonce && bundle[i].hash !== tx.hash) {
        if(i < bundle.length - 1) {
          console.log("Warning: Replacing TX from earlier in the bundle");
        }
        bundle[i] = tx;
        return this.provider.send('eth_sendRawTransaction', params);
      }
    }
    bundle.push(tx);
    showPrompt();
    return this.provider.send('eth_sendRawTransaction', params);
  }

  async getBundle(): Promise<ethers.Transaction[]> {
    if(this.bundle === undefined) {
      this.provider = new ethers.providers.Web3Provider(ganache.provider(GANACHE_CONFIG));
      console.log(`Created fork at block ${await this.provider.getBlockNumber()}`);
      this.bundle = [];
    }
    return this.bundle;
  }

  revertFork() {
    this.bundle = undefined;
    this.provider = this.baseProvider;
  }

  async submitFork(): Promise<boolean> {
    if(this.bundle === undefined) {
      return false;
    }
    const blockno = 1 + await this.baseProvider.getBlockNumber();
    console.log(`Attempting to submit bundle at block number ${blockno}`);
    const flashbotsProvider = await FlashbotsBundleProvider.create(this.baseProvider, authSigner);
    const txresponse = await flashbotsProvider.sendBundle(this.bundle.map((tx) => ({
      signedTransaction: ethers.utils.serializeTransaction(
        tx,
        {r: tx.r as string, s: tx.s as string, v: tx.v as number})
    })), blockno);

    if(isRelayResponseError(txresponse)) {
      console.log(`Error submitting bundle: ${txresponse.error.message}`);
      return false;
    }

    const sim = await txresponse.simulate();
    if(isRelayResponseError(sim)) {
      console.log(`Simulation produced an error: ${sim.error}`);
    } else {
      console.log(`Simulation result: ${sim.firstRevert === undefined ? 'success': 'failure'}`)
    }

    const status = await txresponse.wait();
    switch(status) {
    case FlashbotsBundleResolution.BundleIncluded:
      console.log("Bundle mined!");
      this.revertFork();
      return true;
    case FlashbotsBundleResolution.AccountNonceTooHigh:
      console.log("Failed to mine bundle: account nonce too high. Resetting fork.");
      this.revertFork();
      return true;
    case FlashbotsBundleResolution.BlockPassedWithoutInclusion:
      console.log("Failed to include bundle in block; try again.");
      return false;
    }
  }
}

const proxy = new BundleProxy(provider);
const app = express();
app.use(express.json());
app.use(cors());

app.post('/', async (req, res) => {
  const { id, method, params } = req.body;
  try {
    const result = await proxy.rpcHandler(method, params);
    res.json({
      jsonrpc: "2.0",
      id,
      result
    });
  } catch(e) {
    if((e as any)?.body !== undefined) {
      const { error } = JSON.parse((e as any).body);
      res.json({
        jsonrpc: "2.0",
        id,
        error
      });
    } else {
      console.log(e);
    }
  }
});

app.listen(parseInt(options.port), () => {
  console.log(`Listening on port ${options.port}`);
});

function showPrompt() {
  ac.abort();
  if(!proxy.bundle) {
    return;
  }
  for(let i = 0; i < proxy.bundle?.length; i++) {
    const tx = proxy.bundle[i];
    console.log(`${i + 1}. ${tx.from} -> ${tx.to}`);
  }
  ac = new AbortController();
  rl.question('(S)ubmit, (R)evert?', {signal: ac.signal}, handleResponse);
}

async function handleResponse(response: string) {
  switch(response.toLowerCase()) {
  case 's':
    const result = await proxy.submitFork();
    if(!result) {
      showPrompt();
    }
    break;
  case 'r':
    console.log("Reverting.");
    proxy.revertFork();
    break;
  default:
    showPrompt();
    break;
  }
}
