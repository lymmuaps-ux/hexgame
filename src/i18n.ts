import { decodeMsg, MsgParams } from './game/msg';
import { RESOURCES, Resource } from './game/types';

export type Lang = 'en' | 'ar';
type Dict = Record<string, string>;

const en: Dict = {

  // awards & banners
  'award.road': 'Longest Road', 'award.guard': 'Strongest Guard', 'award.pts': '+2 points',
  'award.unclaimed': 'Unclaimed', 'award.needRoad': 'First road of 5+ takes it', 'award.needGuard': 'First to 3 guards takes it',
  'award.roadLen': 'road of {n}', 'award.guardSize': '{n} guards',
  'banner.yourTurn': 'Your turn!', 'banner.turnOf': "{name}'s turn",
  'banner.award': '{name} takes the {award}!', 'banner.awardLost': '{award} is up for grabs again!',
  'banner.play': '{name} plays {card}!', 'banner.buy': '{name} buys a fortune card',
  // resources, cards, pieces
  'res.timber': 'Timber', 'res.clay': 'Clay', 'res.wool': 'Wool', 'res.grain': 'Grain', 'res.ore': 'Ore',
  'dev.guard': 'Guard', 'dev.roadworks': 'Roadworks', 'dev.harvest': 'Harvest', 'dev.embargo': 'Embargo', 'dev.monument': 'Monument',
  'devText.guard': 'Move the Raider and steal 1 card. Counts toward Strongest Guard.',
  'devText.roadworks': 'Build 2 roads for free.',
  'devText.harvest': 'Take any 2 resources from the bank.',
  'devText.embargo': 'Name a resource. Every opponent gives you all of theirs.',
  'devText.monument': '+1 victory point (kept hidden).',
  'dev.fresh': ' (bought this turn – playable next turn)',
  'piece.road': 'road', 'piece.settlement': 'settlement', 'piece.city': 'city',

  // lobby
  'lobby.tag': 'Settle the island, trade with friends, race to {n} points.',
  'lobby.name': 'Your name', 'lobby.namePh': 'e.g. Sam',
  'lobby.join': 'Join a game', 'lobby.codePh': 'Room code', 'lobby.joinBtn': 'Join',
  'lobby.host': 'Host a game',
  'lobby.hostHint': "You'll get a code to share. Your browser runs the game – keep this tab open.",
  'lobby.create': 'Create game', 'lobby.resume': 'Resume game {code}',
  'lobby.codeErr': 'Enter the 5-letter room code from your host.',
  'lobby.connecting': 'Connecting…', 'lobby.slow': 'This can take up to 30 seconds on some networks.',
  'lobby.roomCode': 'Room code', 'lobby.copyLink': 'Copy link', 'lobby.copied': 'Copied!',
  'lobby.players': 'Players ({n}/4)', 'lobby.start': 'Start game',
  'lobby.needFriend': 'Waiting for at least one friend to join…', 'lobby.ready': 'Everyone in? Start when ready.',
  'lobby.waitHost': 'Waiting for the host to start the game…',
  'lobby.lost': 'Lost connection to the host.',
  'lobby.lostGame': 'Lost connection to the host. Reload and re-join with the same name.',

  // network
  'net.noServer': 'Could not reach any game server. Check your internet connection and try again.',
  'net.noGame': 'No game found with that code. Check the code, and make sure the host still has the game open.',
  'net.notStarted': 'The game has not started yet.', 'net.started': 'This game has already started.',
  'net.full': 'The game is full.', 'net.nameTaken': 'That name is taken – pick another.',
  'net.need2': 'You need at least 2 players.',

  // game log
  'log.start': 'The island has been discovered. Place your first settlements!',
  'log.order': 'Turn order: {names}',
  'log.longestRoad': '🛣️ {name} now holds the Longest Road ({n}).',
  'log.win': '🏆 {name} wins with {n} points!',
  'log.bankOut': 'The bank ran out of {res} – nobody receives any.',
  'log.receives': '{name} receives {cards}',
  'log.setupDone': 'Setup complete. {name}, roll the dice!',
  'log.discards': '{name} discards {n} cards.',
  'log.traded': '🤝 {a} traded {give} to {b} for {get}',
  'log.foundGather': '{name} founds a settlement and gathers {cards}',
  'log.found': '{name} founds a settlement.',
  'log.rolls': '🎲 {name} rolls {n}',
  'log.raider': '🌩️ The Raider stirs!',
  'log.movesRaider': '{name} moves the Raider.',
  'log.buildSettlement': '🏠 {name} builds a settlement.',
  'log.buildCity': '🏰 {name} upgrades to a city.',
  'log.buyDev': '🃏 {name} buys a fortune card.',
  'log.harvest': '🧺 {name} plays Harvest: {cards}',
  'log.embargo': '⚖️ {name} plays Embargo on {res} and collects {n}.',
  'log.roadworks': '🛤️ {name} plays Roadworks.',
  'log.guard': '🛡️ {name} sends a Guard.',
  'log.strongestGuard': '⚔️ {name} now has the Strongest Guard.',
  'log.bankTrade': '{name} trades {n} {give} with the bank for 1 {get}',
  'log.offers': '{name} offers {give} for {get}',
  'log.turn': "— {name}'s turn —",
  'log.steal': '{name} steals a card from {victim}.',

  // rule errors
  'err.over': 'The game is over.', 'err.unknownPlayer': 'Unknown player.',
  'err.noDiscard': 'You do not need to discard.', 'err.discardExactly': 'You must discard exactly {n} cards.',
  'err.invalidCards': 'Invalid cards.', 'err.offerGone': 'That offer is no longer available.',
  'err.ownOffer': 'You cannot respond to your own offer.', 'err.noRequested': 'You do not have the requested cards.',
  'err.offererLacks': '{name} no longer has those cards.', 'err.notTurn': 'It is not your turn.',
  'err.cantSettle': 'You cannot settle there.', 'err.setupRoad': 'The road must touch your new settlement.',
  'err.placeRoad': 'Place a road first.', 'err.placeSettlement': 'Place a settlement first.',
  'err.rolled': 'You already rolled.', 'err.cantRaider': 'You cannot move the Raider now.',
  'err.otherTile': 'Choose a different tile.', 'err.invalidTarget': 'Invalid target.',
  'err.cantBuild': 'You cannot build now.', 'err.noRoads': 'No roads left.',
  'err.notEnough': 'Not enough resources.', 'err.cantRoad': 'You cannot build a road there.',
  'err.noSettlements': 'No settlements left.', 'err.noCities': 'No cities left.',
  'err.upgradeOwn': 'Upgrade one of your settlements.', 'err.cantBuy': 'You cannot buy now.',
  'err.deckEmpty': 'The fortune deck is empty.', 'err.oneDev': 'Only one fortune card per turn.',
  'err.monument': 'Monuments score automatically.', 'err.cantPlay': 'You cannot play that now.',
  'err.noCard': 'You do not have a playable card of that kind.', 'err.pick2': 'Pick 2 resources.',
  'err.bankLacks': 'The bank does not have those.', 'err.pick1': 'Pick a resource.',
  'err.nowhereRoads': 'Nowhere to build roads.', 'err.cantTrade': 'You cannot trade now.',
  'err.twoDifferent': 'Pick two different resources.', 'err.needRate': 'You need {n} {res}.',
  'err.bankOut': 'The bank is out of that resource.', 'err.offerBoth': 'Offer something and ask for something.',
  'err.noCards': 'You do not have those cards.', 'err.finishStep': 'Finish your current step first.',
  'err.unknownAction': 'Unknown action.',

  // HUD
  'hud.room': 'Room {code}', 'hud.copyRoom': 'Copy room code', 'hud.codeCopied': 'Room code copied',
  'hud.rules': 'Rules', 'hud.logTitle': 'Game log', 'hud.log': 'Log', 'hud.switchLang': 'العربية',
  'hud.you': '(you)', 'hud.offline': 'offline',
  'hud.vp': 'Victory points', 'hud.cards': 'Resource cards', 'hud.devCards': 'Fortune cards',
  'hud.guards': 'Guards played', 'hud.longest': 'Longest road',
  'hud.longestRoad': 'Longest Road', 'hud.strongestGuard': 'Strongest Guard',
  'st.rollingMe': 'Rolling…', 'st.rolling': '{name} is rolling…', 'st.wins': '🏆 {name} wins!',
  'st.placeSettlement': 'Place a settlement (glowing spots)', 'st.placeRoad': 'Place a road (glowing spots)',
  'st.placingSettlement': '{name} is placing a settlement…', 'st.placingRoad': '{name} is placing a road…',
  'st.yourRoll': 'Your turn – roll the dice!', 'st.aboutRoll': '{name} is about to roll…',
  'st.discardWait': 'The Raider strikes! Waiting for discards: {names}',
  'st.moveRaider': 'Move the Raider to a new tile', 'st.movingRaider': '{name} is moving the Raider…',
  'st.steal': 'Choose who to steal from', 'st.stealing': '{name} is choosing a victim…',
  'st.roadworks': 'Place {n} free road(s)', 'st.roadworking': '{name} is building roads…',
  'st.turnOf': "{name}'s turn",
  'st.clickSpot': 'Click a glowing spot to build a {what} ({n} available) – or click the button again to cancel',
  'st.actions': 'Build, trade, or end your turn',
  'btn.road': 'Road', 'btn.settlement': 'Settlement', 'btn.city': 'City', 'btn.fortune': 'Fortune',
  'btn.trade': 'Trade', 'btn.tradeSub': 'bank · ports · players', 'btn.left': '{n} left',
  'btn.noSpot': 'no spot yet ⓘ', 'btn.roll': '🎲 Roll dice', 'btn.end': 'End turn ➜',
  'noSpot.settlement': 'No legal spot yet: a settlement must be on one of your roads AND at least 2 road lengths from every other settlement or city. Build another road outward first.',
  'noSpot.road': 'There is no free edge connected to your roads or buildings.',
  'noSpot.city': 'Cities upgrade one of your settlements – you have none left to upgrade.',
  'offer.mine': 'Your offer: give {give} for {get}', 'offer.declined': 'Declined: {names}',
  'offer.waiting': 'waiting…', 'offer.cancel': 'Cancel',
  'offer.incoming': '<b>{name}</b> offers {give} and wants {get}',
  'offer.accept': 'Accept', 'offer.decline': 'Decline',
  'pop.rolled': '{name} rolled', 'pop.rolledAnon': 'Rolled', 'pop.seven': ' – the Raider strikes!',
  'm.pts': '{name} – {n} pts', 'm.reload': 'Reload the page to start a new game.',
  'm.discardTitle': '🌩️ The Raider strikes – discard {n}', 'm.discardBtn': 'Discard {a}/{b}',
  'm.stealTitle': 'Steal a card from…', 'm.cardsN': '{n} cards',
  'm.help': 'How to play',
  'm.pickTitle': '{card}: pick {n} resource(s)', 'm.picked': 'Picked: {list}',
  'm.trade': 'Trade', 'm.tabBank': 'Bank & harbours', 'm.tabPlayers': 'Players',
  'm.give': 'You give', 'm.get': 'You get', 'm.want': 'You want',
  'm.doBank': 'Trade with bank', 'm.offer': 'Offer to everyone',
  'help.body': `<p><b>Goal:</b> first to <b>{n} points</b> on their turn wins. Settlement = 1, City = 2, Longest Road (5+) = 2, Strongest Guard (3+ guards) = 2, Monument = 1.</p>
<p><b>Setup:</b> each player places a settlement + road, then again in reverse order. The second settlement collects the resources around it.</p>
<p><b>Turn:</b> roll the dice – every tile with that number produces for settlements (1) and cities (2) on its corners. Then build, buy fortune cards, and trade.</p>
<p><b>Rolling 7:</b> anyone with more than 7 cards discards half. The roller moves the Raider (blocks a tile) and steals a card from a neighbour of it.</p>
<p><b>Building:</b> settlements need 2 spaces between them and must touch your road (except in setup). Roads must connect to your network.</p>
<p><b>Trading:</b> 4:1 with the bank, 3:1 or 2:1 if you have a settlement on a harbour. Offer trades to other players any time during your turn.</p>
<p><b>Fortune cards:</b> one per turn, not on the turn you bought it. Guards may be played before rolling.</p>
<p><b>Camera:</b> drag to rotate, scroll/pinch to zoom.</p>`,
};

const ar: Dict = {

  'award.road': 'أطول طريق', 'award.guard': 'أقوى حراسة', 'award.pts': '+2 نقطتان',
  'award.unclaimed': 'غير محجوزة', 'award.needRoad': 'أول طريق بطول 5 أو أكثر يفوز بها', 'award.needGuard': 'أول من يلعب 3 حرّاس يفوز بها',
  'award.roadLen': 'طريق بطول {n}', 'award.guardSize': '{n} حرّاس',
  'banner.yourTurn': 'دورك!', 'banner.turnOf': 'دور {name}',
  'banner.award': '{name} يحصل على «{award}»!', 'banner.awardLost': '«{award}» متاحة من جديد!',
  'banner.play': '{name} يلعب «{card}»!', 'banner.buy': '{name} يشتري بطاقة حظ',
  'res.timber': 'خشب', 'res.clay': 'طين', 'res.wool': 'صوف', 'res.grain': 'قمح', 'res.ore': 'خام',
  'dev.guard': 'حارس', 'dev.roadworks': 'أشغال الطرق', 'dev.harvest': 'الحصاد', 'dev.embargo': 'الحظر', 'dev.monument': 'نُصب تذكاري',
  'devText.guard': 'حرّك الغازي واسرق بطاقة واحدة. يُحتسب ضمن «أقوى حراسة».',
  'devText.roadworks': 'ابنِ طريقين مجانًا.',
  'devText.harvest': 'خذ أي موردين من البنك.',
  'devText.embargo': 'اختر موردًا، وسيعطيك كل خصم كل ما لديه منه.',
  'devText.monument': '+1 نقطة فوز (تبقى مخفية).',
  'dev.fresh': ' (اشتريتها في هذا الدور – يمكن لعبها في الدور القادم)',
  'piece.road': 'طريق', 'piece.settlement': 'مستوطنة', 'piece.city': 'مدينة',

  'lobby.tag': 'استوطن الجزيرة، وتاجر مع أصدقائك، وتسابق للوصول إلى {n} نقاط.',
  'lobby.name': 'اسمك', 'lobby.namePh': 'مثال: سامر',
  'lobby.join': 'الانضمام إلى لعبة', 'lobby.codePh': 'رمز الغرفة', 'lobby.joinBtn': 'انضمام',
  'lobby.host': 'استضافة لعبة',
  'lobby.hostHint': 'ستحصل على رمز لمشاركته مع أصدقائك. متصفحك هو من يدير اللعبة – أبقِ هذه الصفحة مفتوحة.',
  'lobby.create': 'إنشاء لعبة', 'lobby.resume': 'استئناف اللعبة {code}',
  'lobby.codeErr': 'أدخل رمز الغرفة المكوّن من 5 أحرف الذي أرسله لك المضيف.',
  'lobby.connecting': 'جارٍ الاتصال…', 'lobby.slow': 'قد يستغرق ذلك حتى 30 ثانية على بعض الشبكات.',
  'lobby.roomCode': 'رمز الغرفة', 'lobby.copyLink': 'نسخ الرابط', 'lobby.copied': 'تم النسخ!',
  'lobby.players': 'اللاعبون ({n}/4)', 'lobby.start': 'ابدأ اللعبة',
  'lobby.needFriend': 'بانتظار انضمام صديق واحد على الأقل…', 'lobby.ready': 'هل انضم الجميع؟ ابدأ عندما تكون مستعدًا.',
  'lobby.waitHost': 'بانتظار أن يبدأ المضيف اللعبة…',
  'lobby.lost': 'انقطع الاتصال بالمضيف.',
  'lobby.lostGame': 'انقطع الاتصال بالمضيف. أعد تحميل الصفحة وانضم مجددًا بالاسم نفسه.',

  'net.noServer': 'تعذّر الوصول إلى أي خادم للعبة. تحقّق من اتصالك بالإنترنت وحاول مجددًا.',
  'net.noGame': 'لا توجد لعبة بهذا الرمز. تحقّق من الرمز وتأكد أن المضيف ما زال يفتح اللعبة.',
  'net.notStarted': 'لم تبدأ اللعبة بعد.', 'net.started': 'هذه اللعبة بدأت بالفعل.',
  'net.full': 'اللعبة ممتلئة.', 'net.nameTaken': 'هذا الاسم مستخدم – اختر اسمًا آخر.',
  'net.need2': 'تحتاج إلى لاعبَين على الأقل.',

  'log.start': 'تم اكتشاف الجزيرة. ضعوا مستوطناتكم الأولى!',
  'log.order': 'ترتيب الأدوار: {names}',
  'log.longestRoad': '🛣️ {name} يملك الآن «أطول طريق» ({n}).',
  'log.win': '🏆 فاز {name} بـ {n} نقاط!',
  'log.bankOut': 'نفد {res} من البنك – لن يحصل أحد على شيء منه.',
  'log.receives': '{name} يحصل على {cards}',
  'log.setupDone': 'اكتمل الإعداد. {name}، ارمِ النرد!',
  'log.discards': '{name} يتخلّص من {n} بطاقات.',
  'log.traded': '🤝 {a} بادل {give} مع {b} مقابل {get}',
  'log.foundGather': '{name} يؤسس مستوطنة ويجمع {cards}',
  'log.found': '{name} يؤسس مستوطنة.',
  'log.rolls': '🎲 {name} يرمي النرد: {n}',
  'log.raider': '🌩️ الغازي يتحرك!',
  'log.movesRaider': '{name} يحرّك الغازي.',
  'log.buildSettlement': '🏠 {name} يبني مستوطنة.',
  'log.buildCity': '🏰 {name} يطوّر مستوطنة إلى مدينة.',
  'log.buyDev': '🃏 {name} يشتري بطاقة حظ.',
  'log.harvest': '🧺 {name} يلعب «الحصاد»: {cards}',
  'log.embargo': '⚖️ {name} يفرض «الحظر» على {res} ويجمع {n}.',
  'log.roadworks': '🛤️ {name} يلعب «أشغال الطرق».',
  'log.guard': '🛡️ {name} يرسل حارسًا.',
  'log.strongestGuard': '⚔️ {name} يملك الآن «أقوى حراسة».',
  'log.bankTrade': '{name} يبادل {n} {give} مع البنك مقابل 1 {get}',
  'log.offers': '{name} يعرض {give} مقابل {get}',
  'log.turn': '— دور {name} —',
  'log.steal': '{name} يسرق بطاقة من {victim}.',

  'err.over': 'انتهت اللعبة.', 'err.unknownPlayer': 'لاعب غير معروف.',
  'err.noDiscard': 'لا تحتاج إلى التخلّص من بطاقات.', 'err.discardExactly': 'يجب أن تتخلّص من {n} بطاقات بالضبط.',
  'err.invalidCards': 'بطاقات غير صالحة.', 'err.offerGone': 'هذا العرض لم يعد متاحًا.',
  'err.ownOffer': 'لا يمكنك الرد على عرضك.', 'err.noRequested': 'ليست لديك البطاقات المطلوبة.',
  'err.offererLacks': 'لم تعد لدى {name} تلك البطاقات.', 'err.notTurn': 'ليس دورك.',
  'err.cantSettle': 'لا يمكنك الاستيطان هناك.', 'err.setupRoad': 'يجب أن يلامس الطريق مستوطنتك الجديدة.',
  'err.placeRoad': 'ضع طريقًا أولًا.', 'err.placeSettlement': 'ضع مستوطنة أولًا.',
  'err.rolled': 'لقد رميت النرد بالفعل.', 'err.cantRaider': 'لا يمكنك تحريك الغازي الآن.',
  'err.otherTile': 'اختر أرضًا أخرى.', 'err.invalidTarget': 'هدف غير صالح.',
  'err.cantBuild': 'لا يمكنك البناء الآن.', 'err.noRoads': 'لم يتبقَّ لديك طرق.',
  'err.notEnough': 'لا تملك موارد كافية.', 'err.cantRoad': 'لا يمكنك بناء طريق هناك.',
  'err.noSettlements': 'لم يتبقَّ لديك مستوطنات.', 'err.noCities': 'لم يتبقَّ لديك مدن.',
  'err.upgradeOwn': 'طوّر إحدى مستوطناتك.', 'err.cantBuy': 'لا يمكنك الشراء الآن.',
  'err.deckEmpty': 'نفدت بطاقات الحظ.', 'err.oneDev': 'بطاقة حظ واحدة فقط في كل دور.',
  'err.monument': 'النُّصب تُحتسب تلقائيًا.', 'err.cantPlay': 'لا يمكنك لعب هذه البطاقة الآن.',
  'err.noCard': 'ليست لديك بطاقة قابلة للعب من هذا النوع.', 'err.pick2': 'اختر موردين.',
  'err.bankLacks': 'البنك لا يملك هذه الموارد.', 'err.pick1': 'اختر موردًا.',
  'err.nowhereRoads': 'لا يوجد مكان لبناء طرق.', 'err.cantTrade': 'لا يمكنك التبادل الآن.',
  'err.twoDifferent': 'اختر موردين مختلفين.', 'err.needRate': 'تحتاج إلى {n} {res}.',
  'err.bankOut': 'نفد هذا المورد من البنك.', 'err.offerBoth': 'اعرض شيئًا واطلب شيئًا.',
  'err.noCards': 'لا تملك هذه البطاقات.', 'err.finishStep': 'أنهِ خطوتك الحالية أولًا.',
  'err.unknownAction': 'إجراء غير معروف.',

  'hud.room': 'غرفة {code}', 'hud.copyRoom': 'نسخ رمز الغرفة', 'hud.codeCopied': 'تم نسخ رمز الغرفة',
  'hud.rules': 'القواعد', 'hud.logTitle': 'سجل اللعبة', 'hud.log': 'السجل', 'hud.switchLang': 'English',
  'hud.you': '(أنت)', 'hud.offline': 'غير متصل',
  'hud.vp': 'نقاط الفوز', 'hud.cards': 'بطاقات الموارد', 'hud.devCards': 'بطاقات الحظ',
  'hud.guards': 'الحرّاس الذين لُعبوا', 'hud.longest': 'أطول طريق',
  'hud.longestRoad': 'أطول طريق', 'hud.strongestGuard': 'أقوى حراسة',
  'st.rollingMe': 'جارٍ رمي النرد…', 'st.rolling': '{name} يرمي النرد…', 'st.wins': '🏆 فاز {name}!',
  'st.placeSettlement': 'ضع مستوطنة (الأماكن المضيئة)', 'st.placeRoad': 'ضع طريقًا (الأماكن المضيئة)',
  'st.placingSettlement': '{name} يضع مستوطنة…', 'st.placingRoad': '{name} يضع طريقًا…',
  'st.yourRoll': 'دورك – ارمِ النرد!', 'st.aboutRoll': '{name} على وشك رمي النرد…',
  'st.discardWait': 'الغازي يهاجم! بانتظار التخلّص من البطاقات: {names}',
  'st.moveRaider': 'حرّك الغازي إلى أرض جديدة', 'st.movingRaider': '{name} يحرّك الغازي…',
  'st.steal': 'اختر من تسرق منه', 'st.stealing': '{name} يختار ضحيته…',
  'st.roadworks': 'ضع الطرق المجانية ({n})', 'st.roadworking': '{name} يبني طرقًا…',
  'st.turnOf': 'دور {name}',
  'st.clickSpot': 'انقر على مكان مضيء لبناء {what} ({n} متاح) – أو انقر الزر مرة أخرى للإلغاء',
  'st.actions': 'ابنِ، أو تاجر، أو أنهِ دورك',
  'btn.road': 'طريق', 'btn.settlement': 'مستوطنة', 'btn.city': 'مدينة', 'btn.fortune': 'بطاقة حظ',
  'btn.trade': 'تبادل', 'btn.tradeSub': 'البنك · الموانئ · اللاعبون', 'btn.left': 'متبقٍ {n}',
  'btn.noSpot': 'لا مكان بعد ⓘ', 'btn.roll': '🎲 ارمِ النرد', 'btn.end': 'أنهِ الدور ⬅',
  'noSpot.settlement': 'لا يوجد مكان صالح بعد: يجب أن تكون المستوطنة على أحد طرقك، وعلى بُعد طريقين على الأقل من أي مستوطنة أو مدينة أخرى. ابنِ طريقًا إضافيًا إلى الخارج أولًا.',
  'noSpot.road': 'لا يوجد ضلع فارغ متصل بطرقك أو مبانيك.',
  'noSpot.city': 'المدن تطوّر إحدى مستوطناتك – ولم يتبقَّ لديك مستوطنات لتطويرها.',
  'offer.mine': 'عرضك: تعطي {give} مقابل {get}', 'offer.declined': 'رفض: {names}',
  'offer.waiting': 'بالانتظار…', 'offer.cancel': 'إلغاء',
  'offer.incoming': '<b>{name}</b> يعرض {give} ويطلب {get}',
  'offer.accept': 'قبول', 'offer.decline': 'رفض',
  'pop.rolled': '{name} رمى النرد', 'pop.rolledAnon': 'النتيجة', 'pop.seven': ' – الغازي يهاجم!',
  'm.pts': '{name} – {n} نقاط', 'm.reload': 'أعد تحميل الصفحة لبدء لعبة جديدة.',
  'm.discardTitle': '🌩️ الغازي يهاجم – تخلّص من {n}', 'm.discardBtn': 'تخلّص {a}/{b}',
  'm.stealTitle': 'اسرق بطاقة من…', 'm.cardsN': '{n} بطاقات',
  'm.help': 'طريقة اللعب',
  'm.pickTitle': '{card}: اختر {n} من الموارد', 'm.picked': 'اخترت: {list}',
  'm.trade': 'تبادل', 'm.tabBank': 'البنك والموانئ', 'm.tabPlayers': 'اللاعبون',
  'm.give': 'تعطي', 'm.get': 'تحصل على', 'm.want': 'تريد',
  'm.doBank': 'بادل مع البنك', 'm.offer': 'اعرض على الجميع',
  'help.body': `<p><b>الهدف:</b> أول من يصل إلى <b>{n} نقاط</b> في دوره يفوز. المستوطنة = 1، المدينة = 2، أطول طريق (5 فأكثر) = 2، أقوى حراسة (3 حرّاس فأكثر) = 2، النُّصب التذكاري = 1.</p>
<p><b>الإعداد:</b> يضع كل لاعب مستوطنة وطريقًا، ثم مرة أخرى بالترتيب المعاكس. المستوطنة الثانية تجمع الموارد المحيطة بها.</p>
<p><b>الدور:</b> ارمِ النرد – كل أرض تحمل الرقم الناتج تُنتج للمستوطنات (1) والمدن (2) الواقعة على زواياها. ثم ابنِ، واشترِ بطاقات الحظ، وتاجر.</p>
<p><b>رمية 7:</b> كل من لديه أكثر من 7 بطاقات يتخلّص من نصفها. يحرّك الرامي الغازي (فيعطّل أرضًا) ويسرق بطاقة من أحد اللاعبين المجاورين لها.</p>
<p><b>البناء:</b> يجب أن تفصل بين المستوطنات مسافة طريقين على الأقل، وأن تلامس طريقك (إلا في الإعداد). ويجب أن تتصل الطرق بشبكتك.</p>
<p><b>التبادل:</b> 4:1 مع البنك، أو 3:1 أو 2:1 إذا كانت لديك مستوطنة على ميناء. ويمكنك عرض صفقات على اللاعبين الآخرين في أي وقت خلال دورك.</p>
<p><b>بطاقات الحظ:</b> بطاقة واحدة في كل دور، ولا تُلعب في الدور الذي اشتريتها فيه. يمكن لعب الحارس قبل رمي النرد.</p>
<p><b>الكاميرا:</b> اسحب للتدوير، ومرّر أو اقرص للتكبير والتصغير.</p>`,
};

const DICTS: Record<Lang, Dict> = { en, ar };

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('hexhold-lang');
    if (saved === 'en' || saved === 'ar') return saved;
  } catch { /* storage unavailable */ }
  return navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

let lang: Lang = initialLang();
const listeners: (() => void)[] = [];

export const getLang = () => lang;

export function applyDir() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem('hexhold-lang', l); } catch { /* ignore */ }
  applyDir();
  listeners.forEach((f) => f());
}

export const onLangChange = (f: () => void) => listeners.push(f);

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Translate a UI key. Parameter values are inserted as given (escape them first for HTML). */
export function t(key: string, params: MsgParams = {}): string {
  const tmpl = DICTS[lang][key] ?? en[key] ?? key;
  return tmpl.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) return `{${k}}`;
    if (k === 'res' && RESOURCES.includes(v as Resource)) return t(`res.${v}`);
    return String(v);
  });
}

export const resLabel = (r: Resource) => t(`res.${r}`);

/** Translate a game message code from the host (log line or error). `html` escapes player-supplied values. */
export function tr(msg: string, html = false): string {
  const d = decodeMsg(msg);
  if (!d) return html ? escHtml(msg) : msg; // e.g. log lines from games saved before translations existed
  const params: MsgParams = {};
  for (const [k, v] of Object.entries(d.params)) params[k] = html && typeof v === 'string' ? escHtml(v) : v;
  return t(d.key, params);
}
