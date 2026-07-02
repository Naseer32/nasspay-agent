import 'dotenv/config';
import { Sphere } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';
import {
  createDeal,
  getDeal,
  listDeals,
  markFunded,
  addReleaseVote,
  addRefundVote,
  closeDeal,
} from './deals.js';

const AGENT_NAMETAG = process.env.AGENT_NAMETAG || 'nasspay-agent';

async function main() {
  const providers = createNodeProviders({
    network: 'testnet',
    dataDir: './wallet-data',
    tokensDir: './tokens',
    oracle: {
      apiKey: process.env.SPHERE_API_KEY,
    },
  });

  const { sphere, created, generatedMnemonic } = await Sphere.init({
    ...providers,
    autoGenerate: true,
    nametag: AGENT_NAMETAG,
  });

  if (created && generatedMnemonic) {
    console.log('\n=== NEW WALLET CREATED ===');
    console.log('Save this recovery phrase somewhere safe:');
    console.log(generatedMnemonic);
    console.log('===========================\n');
  }

  console.log(`Escrow agent online as @${sphere.identity?.nametag ?? AGENT_NAMETAG}`);
  console.log(`Address: ${sphere.identity?.directAddress}`);

  sphere.communications.onDirectMessage(async (msg) => {
    const from = msg.senderNametag;
    const text = (msg.content || '').trim();
    if (!from) return;

    try {
      await handleCommand(sphere, from, text);
    } catch (err) {
      console.error('Error handling command:', err);
      await sphere.communications.sendDM(`@${from}`, `Error: ${err.message}`);
    }
  });

  sphere.on('transfer:confirmed', async (event) => {
    const transfer = event.data;
    console.log('Incoming transfer confirmed:', transfer);
  });

  console.log('\nCommands agents/users can DM to this agent:');
  console.log('  new <sellerNametag> <amount> <coinId> <description...>  (buyer creates a deal)');
  console.log('  fund <dealId>          (buyer confirms they sent payment for a deal)');
  console.log('  release <dealId>       (either buyer or seller releases funds to seller)');
  console.log('  refund <dealId>        (buyer AND seller must both send this to refund)');
  console.log('  status <dealId>        (check a deal\'s status)');
}

async function handleCommand(sphere, from, text) {
  const [cmd, ...rest] = text.split(/\s+/);

  switch ((cmd || '').toLowerCase()) {
    case 'new': {
      const [seller, amount, coinId, ...descParts] = rest;
      if (!seller || !amount || !coinId) {
        return sphere.communications.sendDM(
          `@${from}`,
          'Usage: new <sellerNametag> <amount> <coinId> <description...>'
        );
      }
      const sellerTag = seller.replace(/^@/, '');
      const deal = createDeal({
        buyer: from,
        seller: sellerTag,
        amount,
        coinId: coinId.toUpperCase(),
        description: descParts.join(' '),
      });
      await sphere.communications.sendDM(
        `@${from}`,
        `Deal ${deal.id} created: you pay ${amount} ${deal.coinId} to @${sphere.identity?.nametag}, held in escrow for @${sellerTag}. ` +
          `Send the payment, then DM "fund ${deal.id}" to confirm. Deal releases when you or @${sellerTag} DM "release ${deal.id}".`
      );
      await sphere.communications.sendDM(
        `@${sellerTag}`,
        `New escrow deal ${deal.id}: @${from} will pay you ${amount} ${deal.coinId} via escrow. You'll be notified once funded.`
      );
      break;
    }

    case 'fund': {
      const [dealId] = rest;
      const deal = getDeal(dealId);
      if (!deal) return sphere.communications.sendDM(`@${from}`, `No such deal: ${dealId}`);
      if (deal.buyer !== from) {
        return sphere.communications.sendDM(`@${from}`, `Only the buyer can confirm funding for ${dealId}.`);
      }
      if (deal.status !== 'pending') {
        return sphere.communications.sendDM(`@${from}`, `Deal ${dealId} is already ${deal.status}.`);
      }

      const balance = sphere.payments.getBalance();
      const asset = balance.find((a) => a.coinId === deal.coinId || a.symbol === deal.coinId);
      const held = asset ? BigInt(asset.totalAmount ?? '0') : 0n;

      if (held < BigInt(deal.amount)) {
        return sphere.communications.sendDM(
          `@${from}`,
          `Haven't seen enough ${deal.coinId} yet for deal ${dealId}. Send ${deal.amount} ${deal.coinId} to @${sphere.identity?.nametag} first, then retry "fund ${dealId}".`
        );
      }

      markFunded(dealId);
      await sphere.communications.sendDM(`@${from}`, `Deal ${dealId} funded and held in escrow.`);
      await sphere.communications.sendDM(
        `@${deal.seller}`,
        `Deal ${dealId} is funded. It will release once you or @${deal.buyer} send "release ${dealId}".`
      );
      break;
    }

    case 'release': {
      const [dealId] = rest;
      const deal = getDeal(dealId);
      if (!deal) return sphere.communications.sendDM(`@${from}`, `No such deal: ${dealId}`);
      if (from !== deal.buyer && from !== deal.seller) {
        return sphere.communications.sendDM(`@${from}`, `You're not a party to deal ${dealId}.`);
      }
      if (deal.status !== 'funded') {
        return sphere.communications.sendDM(`@${from}`, `Deal ${dealId} is not in a releasable state (status: ${deal.status}).`);
      }

      const result = await sphere.payments.send({
        recipient: `@${deal.seller}`,
        amount: deal.amount,
        coinId: deal.coinId,
      });

      if (!result.success) {
        return sphere.communications.sendDM(`@${from}`, `Release failed: ${result.error}`);
      }

      closeDeal(dealId, 'released');
      const note = `Deal ${dealId} released: ${deal.amount} ${deal.coinId} sent to @${deal.seller} (triggered by @${from}).`;
      await sphere.communications.sendDM(`@${deal.buyer}`, note);
      await sphere.communications.sendDM(`@${deal.seller}`, note);
      break;
    }

    case 'refund': {
      const [dealId] = rest;
      const deal = getDeal(dealId);
      if (!deal) return sphere.communications.sendDM(`@${from}`, `No such deal: ${dealId}`);
      if (from !== deal.buyer && from !== deal.seller) {
        return sphere.communications.sendDM(`@${from}`, `You're not a party to deal ${dealId}.`);
      }
      if (deal.status !== 'funded') {
        return sphere.communications.sendDM(`@${from}`, `Deal ${dealId} is not in a refundable state (status: ${deal.status}).`);
      }

      const updated = addRefundVote(dealId, from);
      const bothAgreed = updated.refundVotes.includes(deal.buyer) && updated.refundVotes.includes(deal.seller);

      if (!bothAgreed) {
        await sphere.communications.sendDM(
          `@${from}`,
          `Refund request recorded for ${dealId}. Waiting on the other party to also confirm.`
        );
        const other = from === deal.buyer ? deal.seller : deal.buyer;
        await sphere.communications.sendDM(
          `@${other}`,
          `@${from} requested a refund for deal ${dealId}. DM "refund ${dealId}" to agree, or "release ${dealId}" to release funds instead.`
        );
        return;
      }

      const result = await sphere.payments.send({
        recipient: `@${deal.buyer}`,
        amount: deal.amount,
        coinId: deal.coinId,
      });

      if (!result.success) {
        return sphere.communications.sendDM(`@${from}`, `Refund failed: ${result.error}`);
      }

      closeDeal(dealId, 'refunded');
      const note = `Deal ${dealId} refunded: ${deal.amount} ${deal.coinId} returned to @${deal.buyer} (both parties agreed).`;
      await sphere.communications.sendDM(`@${deal.buyer}`, note);
      await sphere.communications.sendDM(`@${deal.seller}`, note);
      break;
    }

    case 'status': {
      const [dealId] = rest;
      if (!dealId) {
        const mine = listDeals().filter((d) => d.buyer === from || d.seller === from);
        if (mine.length === 0) return sphere.communications.sendDM(`@${from}`, 'No deals found for you.');
        const lines = mine.map((d) => `${d.id}: ${d.status} (${d.amount} ${d.coinId}, buyer=@${d.buyer}, seller=@${d.seller})`);
        return sphere.communications.sendDM(`@${from}`, lines.join('\n'));
      }
      const deal = getDeal(dealId);
      if (!deal) return sphere.communications.sendDM(`@${from}`, `No such deal: ${dealId}`);
      await sphere.communications.sendDM(
        `@${from}`,
        `Deal ${deal.id}: ${deal.status}\nBuyer: @${deal.buyer}\nSeller: @${deal.seller}\nAmount: ${deal.amount} ${deal.coinId}\n` +
          `Description: ${deal.description || '(none)'}\nRelease votes: ${deal.releaseVotes.join(', ') || 'none'}\n` +
          `Refund votes: ${deal.refundVotes.join(', ') || 'none'}`
      );
      break;
    }

    default:
      await sphere.communications.sendDM(
        `@${from}`,
        'Unknown command. Try: new, fund, release, refund, status'
      );
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
