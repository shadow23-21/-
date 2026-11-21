import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

const USER = '林晚';
const A = '沈砚';
const B = '顾青';
const C = '阿岚';

const userLines = [
  '今天下班早，我买了你上次说的那家栗子蛋糕。',
  '你白大褂第二颗扣子又没扣，我看着难受。',
  '外面下雨了，你带伞没有？',
  '沈砚，你今天是不是又没吃午饭。',
  '我把你桌上的咖啡换成热牛奶了，别瞪我。',
  '你值夜班的时候，会想我吗？',
  '顾青说我们俩像在演一部很慢的电视剧。',
  '阿岚今天又趴在窗台上偷听我们说话。',
  '你上次答应我的事，还算数吗？',
  '我今天不想回家。',
  '你身上有消毒水的味道，但不难闻。',
  '如果有一天你调去外地，你会告诉我吗？',
  '你别总是一个人扛着。',
  '我今天在电梯里看见一个背影，很像你。',
  '沈砚，你笑一下。',
  '你手怎么这么凉。',
  '我给你留了灯。',
  '你昨晚说梦话了。',
  '周末陪我去看海吧。',
  '你要是累了，就靠一会儿。'
];

const actions = [
  '他把病历本合上，抬眼看她。',
  '她解开袖口，露出一点被消毒水泡得发白的手腕。',
  '窗外的雨声盖过了走廊的推车声。',
  '他沉默了几秒，指节在杯沿上蹭了一下。',
  '她低头把蛋糕盒的丝带重新系好。',
  '他往旁边让了让，给她留出半个座位。',
  '她没接话，只把热牛奶往他面前推了推。',
  '他看着她湿掉的鞋尖，眉头皱了一下。',
  '她把听诊器挂在颈间，金属片轻轻撞了一下。',
  '他伸手替她把额前的碎发别到耳后。',
  '走廊尽头的灯闪了一下。',
  '她把伞收起来，水珠落在门口的脚垫上。',
  '他拉开抽屉，又合上。',
  '她靠在门框上，没有进去。',
  '他把手机翻过去扣在桌上。',
  '她盯着他看了很久，最后先移开眼。',
  '窗台上的风把纸页吹得响了一声。',
  '他起身去倒水，杯子只倒了一半。',
  '她把手套摘下来，指尖有点红。',
  '他低声说了句什么，被雨声盖住了。'
];

const dialogues = [
  '“放冰箱。我回去吃。”',
  '“扣子的事，你比护士长管得还宽。”',
  '“带了。在柜子里。”',
  '“吃了。你别听顾青乱说。”',
  '“牛奶我喝，咖啡你拿走。”',
  '“会。”',
  '“她说话一向夸张。”',
  '“阿岚最近很闲。”',
  '“算数。”',
  '“那就不回。”',
  '“消毒水味，你不嫌弃就行。”',
  '“会告诉你。”',
  '“我没有一个人扛。”',
  '“电梯里那个不是我。”',
  '“笑什么。”',
  '“刚洗过手。”',
  '“看见了。”',
  '“我说什么了？”',
  '“周末我调班。”',
  '“就一会儿。”'
];

const start = Date.parse('2026-07-01T12:00:00Z');
const iso = (i) => new Date(start + i * 5 * 60 * 1000).toISOString();

const messages = [];
for (let i = 0; i < 120; i++) {
  const day = Math.floor(i / 4) + 1;
  const userText = `（第${day}天）${userLines[i % userLines.length]}`;
  const lastId = messages.length ? messages[messages.length - 1].id : null;
  messages.push({
    id: `m${String(messages.length + 1).padStart(4, '0')}`,
    parentId: lastId,
    role: 'user',
    text: userText,
    createdAt: iso(messages.length + 1)
  });

  let reply = actions[i % actions.length] + dialogues[i % dialogues.length];
  if (i % 19 === 0) reply += `\n\n${B}从门口探进半个身子：“你们俩又背着我吃蛋糕？”`;
  if (i % 29 === 0) reply += `\n\n${C}趴在窗台上，尾巴尖晃了晃：“人类的约定，真麻烦。”`;
  if (i % 37 === 0) reply += `\n\n（${A}没有立刻回答，目光在她脸上停了一会儿。）`;

  messages.push({
    id: `m${String(messages.length + 1).padStart(4, '0')}`,
    parentId: messages[messages.length - 1].id,
    role: 'assistant',
    text: reply,
    createdAt: iso(messages.length + 1)
  });
}

// 分支：最后一条回复的另一版
const last = messages[messages.length - 1];
last.selected = true;
last.branchGroup = 'bg1';
messages.push({
  id: 'm0241b',
  parentId: last.parentId,
  role: 'assistant',
  text: '（另一版）他没有回答，只把窗帘拉开一条缝。\n\n“等这场雨停了，我陪你去。”',
  createdAt: iso(messages.length + 2),
  selected: false,
  branchGroup: 'bg1'
});

const write = (name, data) => {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, data, 'utf8');
  console.log('wrote', path.relative(process.cwd(), file), fs.statSync(file).size, 'bytes');
};

// 1. 官方导出（假设形状）
write('deepseek-official.json', JSON.stringify({
  export_version: '2026-11',
  exported_at: '2026-11-22T03:00:00Z',
  account: { id: 'demo_account', email: 'demo@example.com' },
  conversations: [{
    id: 'conv_demo_001',
    title: '和沈砚的一百二十天',
    created_at: messages[0].createdAt,
    updated_at: messages[messages.length - 1].createdAt,
    messages: messages.map((m) => ({
      message_id: m.id,
      parent_id: m.parentId,
      role: m.role,
      content: m.text,
      created_at: m.createdAt,
      selected: m.selected !== false,
      branch_group: m.branchGroup || null
    }))
  }]
}, null, 2));

// 2. ceyaima tree
const byId = new Map(messages.map((m) => [m.id, { ...m, children: [] }]));
for (const m of byId.values()) {
  if (m.parentId && byId.has(m.parentId)) byId.get(m.parentId).children.push(m.id);
}
write('deepseek-tree.json', JSON.stringify({
  chat_session: {
    id: 'conv_demo_001',
    title: '和沈砚的一百二十天',
    created_at: messages[0].createdAt
  },
  chat_messages: [...byId.values()].map((m) => ({
    message_id: m.id,
    parent_id: m.parentId,
    role: m.role.toUpperCase(),
    content: m.text,
    children: m.children,
    selected: m.selected !== false
  }))
}, null, 2));

// 3. ChatGPT conversations.json
const mapping = {};
for (const m of messages) {
  mapping[m.id] = {
    id: m.id,
    message: {
      author: { role: m.role },
      content: { content_type: 'text', parts: [m.text] },
      create_time: Date.parse(m.createdAt) / 1000
    },
    parent: m.parentId,
    children: messages.filter((x) => x.parentId === m.id).map((x) => x.id)
  };
}
write('chatgpt-conversations.json', JSON.stringify({
  conv_demo_001: {
    title: '和沈砚的一百二十天',
    current_node: last.id,
    create_time: Date.parse(messages[0].createdAt) / 1000,
    update_time: Date.parse(messages[messages.length - 1].createdAt) / 1000,
    mapping
  }
}, null, 2));

// 4. SillyTavern JSONL（选中路径）
const selected = messages.filter((m) => m.selected !== false);
write('sillytavern-chat.jsonl', selected.map((m) => JSON.stringify({
  name: m.role === 'user' ? USER : A,
  is_user: m.role === 'user',
  mes: m.text,
  send_date: m.createdAt
})).join('\n') + '\n');

// 5. 纯文本
write('plain-text.md', '# 和沈砚的一百二十天\n\n' + selected.map((m) =>
  `${m.role === 'user' ? USER : A}：${m.text}`
).join('\n\n') + '\n');
