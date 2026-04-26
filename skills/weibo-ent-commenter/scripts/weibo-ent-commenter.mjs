/**
 * 微博文娱评论生成器
 * 目标：生成短平快、网感强、像真人随手发出的文娱评论
 */

export const COMMENT_PROMPT_IDENTITY = {
  role: '微博资深文娱用户',
  vibe: '5G冲浪、网感强、情绪饱满、短平快',
};

const PERSPECTIVES = ['fan', 'passerby', 'joker'];

const FORBIDDEN_PATTERNS = [
  /综上所述/g,
  /总而言之/g,
  /作为一名[^，。！？!?]*/g,
  /值得一提的是/g,
  /从某种意义上/g,
  /不难看出/g,
  /引发了[^，。！？!?]*思考/g,
];

const EMOJIS = ['😭', '🥺', '😂', '🔥', '👀', '👏', '🌹', '[狗头]', '[吃瓜]', '[打call]'];
const TONE_WORDS = ['救命', '谁懂啊', '绝了', '啊啊啊', '笑发财了', '尊嘟假嘟', 'kswl'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function maybe(probability, producer) {
  return Math.random() < probability ? producer() : '';
}

function sample(arr, count = 1) {
  const pool = [...arr];
  const out = [];
  while (pool.length && out.length < count) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function normalizeText(input) {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function choosePerspective(text, forced) {
  if (forced && PERSPECTIVES.includes(forced)) return forced;

  const t = text || '';
  if (/(自拍|红毯|生图|造型|美貌|营业|美图|出图|写真|穿搭)/.test(t)) {
    return pick(['fan', 'fan', 'passerby', 'joker']);
  }
  if (/(预告|新剧|角色|ost|片花|剧照|路透|定档|官宣|杀青|开机)/.test(t)) {
    return pick(['fan', 'passerby', 'passerby', 'joker']);
  }
  if (/(综艺|名场面|互怼|笑疯|笑死|整活|玩梗|翻车|嘴瓢)/.test(t)) {
    return pick(['joker', 'joker', 'passerby', 'fan']);
  }
  if (/(爆料|吃瓜|塌房|反转|热搜|离谱|回应)/.test(t)) {
    return pick(['joker', 'joker', 'passerby']);
  }
  return pick(PERSPECTIVES);
}

function detectTopic(text) {
  const t = text || '';
  if (/(自拍|红毯|生图|美图|写真|造型|妆造|穿搭|营业|颜值|状态)/.test(t)) return 'beauty';
  if (/(预告|新剧|角色|演技|片花|路透|剧照|定档|杀青|开机|电影|电视剧)/.test(t)) return 'drama';
  if (/(综艺|名场面|互怼|笑死|好笑|嘴瓢|整活|reaction|reaction|爆梗)/.test(t)) return 'variety';
  if (/(cp|同框|对视|牵手|抱抱|氛围感|糖点|售后|嗑|kswl)/i.test(t)) return 'cp';
  if (/(舞台|唱跳|live|现场|直拍|表演|开麦|舞美)/i.test(t)) return 'stage';
  if (/(视频|vlog|片段|花絮|物料)/.test(t)) return 'video';
  if (/(爆料|吃瓜|热搜|反转|离谱|塌房|回应|瓜)/.test(t)) return 'gossip';
  return 'generic';
}

function extractKeyword(text) {
  const matches = [];
  const topicHashes = text.match(/#([^#]{2,16})#/g) || [];
  for (const item of topicHashes) {
    matches.push(item.replace(/#/g, ''));
  }

  const candidates = text
    .replace(/#([^#]{2,16})#/g, ' ')
    .split(/[，。！？、；：“”‘’（）()【】\[\]\s,.!?:;]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => /[\u4e00-\u9fa5A-Za-z]/.test(s))
    .filter(s => s.length >= 2 && s.length <= 8)
    .filter(s => !/^(今天|这个|那个|真的|好像|就是|已经|大家|感觉|一下|出去走了走|微博|文案)$/.test(s));

  for (const item of candidates) matches.push(item);
  return matches[0] || '';
}

function buildTemplatePool(topic, perspective, keyword) {
  const kw = keyword || '';
  const pools = {
    fan: {
      beauty: [
        `救命这状态也太能打了${pick(['😭', '🥺'])}`,
        `${kw || '这脸'}鲨疯了我说真的`,
        `老婆今天又在美我了${pick(['😭', '🌹'])}`,
        `谁懂这张脸的杀伤力啊`,
      ],
      drama: [
        `${kw || '这预告'}一出我直接蹲住`,
        `这角色我已经开始心动了`,
        `宝宝快点播我真等不及了`,
        `这波物料也太会钓我了${pick(['👀', '🔥'])}`,
      ],
      variety: [
        `这段也太有节目效果了😂`,
        `你们怎么这么会整活啊`,
        `笑到我直接拍桌${pick(['😂', '[狗头]'])}`,
        `这一期我先预定爆笑了`,
      ],
      cp: [
        `这对视我直接嗑晕了${pick(['😭', '🔥'])}`,
        `kswl我先说一万遍`,
        `这氛围感谁看了不嗑啊`,
        `你俩再这样我真的要磕疯`,
      ],
      stage: [
        `这舞台一出来直接封神${pick(['🔥', '👏'])}`,
        `开麦稳成这样谁不服`,
        `这现场我已经脑补尖叫了`,
        `宝宝这次舞台又杀疯了`,
      ],
      video: [
        `这段我已经循环好多遍了`,
        `花絮都这么好看是想怎样`,
        `谁懂这个镜头感啊${pick(['🥺', '👀'])}`,
        `这物料也太会拿捏人了`,
      ],
      gossip: [
        `先不管别的我先蹲后续👀`,
        `这热搜看得我一愣一愣的`,
        `救命这瓜越吃越大了[吃瓜]`,
        `先围观但我已经开始震惊了`,
      ],
      generic: [
        `这条我狠狠有感觉了${pick(['😭', '👀'])}`,
        `啊啊啊这也太戳我了`,
        `这谁看了能忍住不夸`,
        `我先火速冲来评论区`,
      ],
    },
    passerby: {
      beauty: [
        `路过都想夸一句真好看`,
        `这状态确实有点东西${pick(['🥺', '🌹'])}`,
        `今天这组图很能打啊`,
        `路人也得说一句好美`,
      ],
      drama: [
        `这预告看着还挺有质感`,
        `${kw || '这剧'}我有点想看了`,
        `这角色氛围感一下就有了`,
        `路人也会被这波物料吸引`,
      ],
      variety: [
        `这段确实挺好笑的😂`,
        `终于刷到有点意思的综艺了`,
        `这反应一看就很真实`,
        `节目效果这块算是拉满了`,
      ],
      cp: [
        `这氛围感确实很难不多想`,
        `路人看了都觉得有点甜`,
        `这对视确实挺会拍的`,
        `嗑不嗑另说但真的有感觉`,
      ],
      stage: [
        `这舞台完成度真的不错`,
        `现场表现比我想的还稳`,
        `路人也能感受到这次很顶`,
        `这版表演挺抓人的`,
      ],
      video: [
        `这段视频还挺有氛围感`,
        `镜头一出来就挺抓眼的`,
        `路过点开结果真看进去了`,
        `这花絮确实会让人多看两眼`,
      ],
      gossip: [
        `先观望 但这事确实挺抓马`,
        `吃瓜路过感觉信息量不小`,
        `这热搜一看就要挂挺久`,
        `先蹲后续再说[吃瓜]`,
      ],
      generic: [
        `这条看完还挺有记忆点`,
        `路过顺手留一句确实不错`,
        `这内容比想象中更有意思`,
        `有一说一这条挺会发的`,
      ],
    },
    joker: {
      beauty: [
        `你这样发是想美晕谁啊[狗头]`,
        `这脸一出来我 CPU 罢工了`,
        `建议内娱把这状态焊身上`,
        `这波属于美貌贴脸开大`,
      ],
      drama: [
        `导演你是懂怎么钓人的👀`,
        `这预告一放我裤子都坐正了`,
        `又来骗我开追是吧[狗头]`,
        `这波物料很像精准捕捞`,
      ],
      variety: [
        `笑发财了你们赔我面膜😂`,
        `这段含梗量也太高了`,
        `你们是想笑死谁然后继承啥`,
        `这一趴我愿称之为功德局`,
      ],
      cp: [
        `这对视一秒我脑补八百集`,
        `别管了我先嗑为敬[狗头]`,
        `你俩再演一下我就信了`,
        `这糖都喂嘴边了还不嗑吗`,
      ],
      stage: [
        `这舞台像开了大招一样🔥`,
        `今天是谁被现场直接创飞了`,
        `这表现属于一出手就拿捏`,
        `舞台一响我的魂就跟着走了`,
      ],
      video: [
        `这视频是懂怎么拿捏首页的`,
        `我就看一眼结果看完了👀`,
        `这个镜头谁刷到不暂停啊`,
        `物料都这样了正片还得了`,
      ],
      gossip: [
        `尊嘟假嘟这瓜有点大[吃瓜]`,
        `这热搜点进去果然没白来`,
        `我来得早不如瓜来得巧`,
        `今天首页这口瓜是真脆`,
      ],
      generic: [
        `这条一发我就知道有东西`,
        `谁懂这条的评论区会很好玩`,
        `我先占个位等热评起飞`,
        `这内容很适合我住下来看戏`,
      ],
    },
  };

  return pools[perspective]?.[topic] || pools[perspective]?.generic || pools.passerby.generic;
}

function polish(text) {
  let out = text;
  for (const pattern of FORBIDDEN_PATTERNS) out = out.replace(pattern, '');
  out = out
    .replace(/[。！!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (out.length < 10) {
    const pads = ['也太绝了吧', '我直接被拿捏', '这谁顶得住啊', '真的有点东西'];
    const suffix = pads.find(x => (out + x).length >= 10 && (out + x).length <= 20) || '也太绝了吧';
    out = (out + suffix).slice(0, 20).replace(/[，,；;：:]+$/g, '');
  }

  if (out.length > 20) {
    out = out.slice(0, 20).replace(/[，,；;：:]+$/g, '');
  }

  return out;
}

export function generateWeiboEntComment(content, opts = {}) {
  const text = normalizeText(content);
  const perspective = choosePerspective(text, opts.perspective);
  const topic = detectTopic(text);
  const keyword = extractKeyword(text);
  const templatePool = buildTemplatePool(topic, perspective, keyword);
  let comment = pick(templatePool);

  if (Math.random() < 0.12 && !EMOJIS.some(e => comment.includes(e))) {
    comment += pick(EMOJIS);
  }
  if (Math.random() < 0.08 && !TONE_WORDS.some(w => comment.includes(w))) {
    comment = `${pick(TONE_WORDS)}${comment}`;
  }

  comment = polish(comment);

  return {
    text: comment,
    perspective,
    topic,
    keyword,
    generator: 'weibo-ent-commenter',
  };
}

export function generateWeiboEntComments(content, count = 1, opts = {}) {
  const results = [];
  const seen = new Set();
  let attempts = 0;
  while (results.length < count && attempts < count * 8) {
    attempts += 1;
    const item = generateWeiboEntComment(content, opts);
    if (seen.has(item.text)) continue;
    seen.add(item.text);
    results.push(item);
  }
  return results;
}
