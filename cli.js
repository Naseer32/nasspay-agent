#!/usr/bin/env node
import 'dotenv/config';
import { Sphere } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';

const [, , nametag, command, ...args] = process.argv;

if (!nametag || !command) {
  console.log('Usage: node cli.js <yourNametag> <command> [...args]');
  console.log('Commands:');
  console.log('  send <recipient> <amount> <coinId>          - send tokens directly');
  console.log('  mint <coinId> <amount>                       - self-mint testnet tokens');
  console.log('  dm <recipient> <message...>                  - send a raw DM (used to talk to the escrow agent)');
  console.log('  balance                                      - show wallet balance');
  console.log('  whoami                                       - show this wallet\'s identity');
  process.exit(1);
}

async function main() {
  const providers = createNodeProviders({
    network: 'testnet',
    dataDir: `./cli-wallets/${nametag}`,
    tokensDir: `./cli-wallets/${nametag}/tokens`,
    oracle: { apiKey: process.env.SPHERE_API_KEY },
  });

  const { sphere, created, generatedMnemonic } = await Sphere.init({
    ...providers,
    autoGenerate: true,
    nametag,
  });

  if (created && generatedMnemonic) {
    console.log(`New wallet created for @${nametag}. Recovery phrase (save it):`);
    console.log(generatedMnemonic);
  }

  switch (command) {
    case 'whoami': {
      console.log(`@${sphere.identity?.nametag}`);
      console.log(sphere.identity?.directAddress);
      break;
    }

    case 'balance': {
      const balance = sphere.payments.getBalance();
      console.log(balance);
      break;
    }

    case 'mint': {
      const [coinId, amount] = args;
      const { getCoinIdBySymbol } = await import('@unicitylabs/sphere-sdk');
      const hexId = getCoinIdBySymbol(coinId.toUpperCase()) || coinId;
      const result = await sphere.payments.mintFungibleToken(hexId, BigInt(amount));
      console.log(result);
      break;
    }

    case 'send': {
      const [recipient, amount, coinId] = args;
      const result = await sphere.payments.send({
        recipient: recipient.startsWith('@') ? recipient : `@${recipient}`,
        amount,
        coinId: coinId.toUpperCase(),
      });
      console.log(result);
      break;
    }

    case 'dm': {
      const [recipient, ...msgParts] = args;
      const message = msgParts.join(' ');
      await sphere.communications.sendDM(recipient.startsWith('@') ? recipient : `@${recipient}`, message);
      console.log(`Sent to @${recipient}: ${message}`);

      const timeout = setTimeout(() => {
        console.log('(no reply received within 10s — the agent may still be processing; run the agent to check its logs)');
        process.exit(0);
      }, 10000);

      sphere.communications.onDirectMessage((msg) => {
        console.log(`\nReply from @${msg.senderNametag}: ${msg.content}`);
        clearTimeout(timeout);
        process.exit(0);
      });
      return;
    }

    default:
      console.log(`Unknown command: ${command}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
