/**
 * Asks the configured relay the two questions a browser will ask it.
 *
 * A call that cannot connect looks the same from the inside whether the relay
 * is missing, unreachable, or refusing the credential, and the browser will
 * not say which. This does: it sends a real STUN binding request and then a
 * real TURN allocate signed the way the server signs one, and reports what
 * came back.
 *
 * Run it from wherever a caller sits, not from the machine hosting the relay:
 * the interesting failure is a port that is open locally and closed to the
 * internet.
 */
import { createSocket } from 'node:dgram';
import { createHash, createHmac, randomBytes } from 'node:crypto';

const COOKIE = 0x2112a442;
const TIMEOUT_MS = 6000;

const urls = (process.env.TURN_URLS ?? '')
  .split(',')
  .map((url) => url.trim())
  .filter((url) => url !== '');

if (urls.length === 0) {
  console.error('TURN_URLS is empty. Nothing to check, and calls will only work on one network.');
  process.exit(1);
}

const secret = process.env.TURN_SECRET ?? '';
const user = process.env.TURN_USERNAME ?? '';
const password = process.env.TURN_PASSWORD ?? '';

/** `turn:host:port` and `stun:host:port`, with the port optional. */
function split(url) {
  const [scheme, rest = ''] = url.split(':', 2);
  const withoutQuery = url.slice(scheme.length + 1).split('?')[0] ?? rest;
  const parts = withoutQuery.split(':');

  return {
    scheme,
    host: parts[0] ?? '',
    port: Number(parts[1] ?? 3478),
  };
}

function pack(type, value) {
  const padding = (4 - (value.length % 4)) % 4;
  const out = Buffer.alloc(4 + value.length + padding);
  out.writeUInt16BE(type, 0);
  out.writeUInt16BE(value.length, 2);
  value.copy(out, 4);
  return out;
}

function frame(type, transaction, attributes, key) {
  let body = Buffer.concat(attributes);

  if (key) {
    // The integrity is computed over a header whose length already counts it.
    const header = Buffer.alloc(20);
    header.writeUInt16BE(type, 0);
    header.writeUInt16BE(body.length + 24, 2);
    header.writeUInt32BE(COOKIE, 4);
    transaction.copy(header, 8);

    const digest = createHmac('sha1', key)
      .update(Buffer.concat([header, body]))
      .digest();
    body = Buffer.concat([body, pack(0x0008, digest)]);
  }

  const header = Buffer.alloc(20);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(body.length, 2);
  header.writeUInt32BE(COOKIE, 4);
  transaction.copy(header, 8);
  return Buffer.concat([header, body]);
}

function unpack(reply) {
  const attributes = new Map();
  let at = 20;

  while (at + 4 <= reply.length) {
    const type = reply.readUInt16BE(at);
    const length = reply.readUInt16BE(at + 2);
    attributes.set(type, reply.subarray(at + 4, at + 4 + length));
    at += 4 + length + ((4 - (length % 4)) % 4);
  }

  return { type: reply.readUInt16BE(0), attributes };
}

/** XOR-MAPPED-ADDRESS and XOR-RELAYED-ADDRESS carry the port and address masked. */
function address(value) {
  if (!value || value.length < 8) return null;

  const port = value.readUInt16BE(2) ^ (COOKIE >>> 16);
  const host = [...value.subarray(4, 8)]
    .map((byte, index) => byte ^ ((COOKIE >>> (24 - index * 8)) & 0xff))
    .join('.');

  return `${host}:${String(port)}`;
}

async function ask(socket, packet, target) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    socket.once('message', (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    socket.send(packet, target.port, target.host);
  });
}

let failures = 0;

for (const url of urls) {
  const target = split(url);
  if (target.scheme !== 'stun' && target.scheme !== 'turn') {
    console.log(`${url}: not checked, this only speaks plain stun and turn`);
    continue;
  }

  const socket = createSocket('udp4');
  socket.on('error', () => undefined);

  const binding = await ask(socket, frame(0x0001, randomBytes(12), []), target);
  if (!binding) {
    console.log(`${url}: no answer. The port is closed, or nothing is listening on it.`);
    failures += 1;
    socket.close();
    continue;
  }

  const seen = address(unpack(binding).attributes.get(0x0020));
  console.log(`${url}: answered, and sees this machine at ${seen ?? 'an address it did not say'}`);

  if (target.scheme === 'stun') {
    socket.close();
    continue;
  }

  if (secret === '' && user === '') {
    console.log(`${url}: no credential configured, so the relay half was not checked`);
    socket.close();
    continue;
  }

  const transport = Buffer.alloc(4);
  transport.writeUInt8(17, 0);

  const challenge = await ask(
    socket,
    frame(0x0003, randomBytes(12), [pack(0x0019, transport)]),
    target,
  );
  if (!challenge) {
    console.log(`${url}: no answer to an allocate request`);
    failures += 1;
    socket.close();
    continue;
  }

  const asked = unpack(challenge);
  const realm = asked.attributes.get(0x0014);
  const nonce = asked.attributes.get(0x0015);

  if (!realm || !nonce) {
    console.log(`${url}: expected a challenge, got type 0x${asked.type.toString(16)}`);
    failures += 1;
    socket.close();
    continue;
  }

  const username =
    secret === '' ? user : `${String(Math.floor(Date.now() / 1000) + 600)}:relay-check`;
  const credential =
    secret === '' ? password : createHmac('sha1', secret).update(username).digest('base64');

  const key = createHash('md5').update(`${username}:${realm.toString()}:${credential}`).digest();

  const allocated = await ask(
    socket,
    frame(
      0x0003,
      randomBytes(12),
      [
        pack(0x0019, transport),
        pack(0x0006, Buffer.from(username)),
        pack(0x0014, realm),
        pack(0x0015, nonce),
      ],
      key,
    ),
    target,
  );

  socket.close();

  if (!allocated) {
    console.log(`${url}: no answer to the signed allocate`);
    failures += 1;
    continue;
  }

  const answer = unpack(allocated);
  if (answer.type === 0x0103) {
    console.log(
      `${url}: relayed a port at ${address(answer.attributes.get(0x0016)) ?? 'an address it did not say'}`,
    );
    continue;
  }

  const error = answer.attributes.get(0x0009);
  const code = error ? error.readUInt8(2) * 100 + error.readUInt8(3) : 0;
  console.log(
    `${url}: refused the credential, ${String(code)} ${error ? error.subarray(4).toString() : ''}`,
  );
  failures += 1;
}

if (failures > 0) {
  console.error(
    `\n${String(failures)} of ${String(urls.length)} did not work. Calls between two networks will not connect.`,
  );
  process.exit(1);
}

console.log('\nThe relay works.');
