import type { Messages } from './types';
import { accusative, dative, genitive } from './azMorphology';

/**
 * Ordinals carry a suffix chosen by how the number is *said*: 1-ci, 3-cü, 6-cı,
 * 9-cu. Getting it from the last digit is exactly how a speaker does it.
 */
const BY_LAST_DIGIT = ['', 'ci', 'ci', 'cü', 'cü', 'ci', 'cı', 'ci', 'ci', 'cu'];
const BY_TENS = ['', 'cu', 'ci', 'cu', 'cı', 'ci', 'cı', 'ci', 'ci', 'cı'];

function ordinal(n: number): string {
  const lastDigit = n % 10;
  if (lastDigit !== 0) return `${n}-${BY_LAST_DIGIT[lastDigit]}`;
  const tens = Math.floor((n % 100) / 10);
  if (tens !== 0) return `${n}-${BY_TENS[tens]}`;
  return `${n}-cü`;
}

export const az: Messages = {
  lang: 'az',
  nativeName: 'Azərbaycan',
  shortName: 'AZ',
  // A comma is the decimal separator in Azerbaijani.
  decimal: (value, digits) => value.toFixed(digits).replace('.', ','),

  app: {
    title: 'AI Domino Oyunçusu',
    tagline: 'Canlı domino oyununu izləyin və öz növbənizdə tövsiyə alın.',
    languageLabel: 'Dil',
  },

  role: { you: 'Siz', partner: 'Tərəfdaş', opponent: 'Rəqib' },
  side: { left: 'sol', right: 'sağ' },

  common: {
    back: 'Geri',
    done: 'Hazır',
    showAllAnyway: 'Yenə də hamısını göstər',
  },

  names: {
    heading: 'Oyunçuların adları',
    hint: 'Oturuş və növbə sırası — sizdən başlayaraq saat əqrəbi istiqamətində. Boş buraxsanız, yerin hərfi görünür.',
    reset: 'A–D-yə qaytar',
    summary: (order) => `Oyunçular: ${order}`,
    edit: 'Adları dəyiş',
    duplicateWarning: (quoted) =>
      `İki oyunçunun adı ${quoted} — gedişlər siyahısını oxumaq çətin olacaq.`,
  },

  home: {
    scoreHeading: (us, them) => `Siz ${us} – ${them} Onlar`,
    teams: (us, them) => `${us} — ${them}`,
    matchWon: (winner, target) =>
      winner === 'us'
        ? `Matçı siz qazandınız. Oyun ${target} xala qədər idi.`
        : `Matçı onlar qazandı. Oyun ${target} xala qədər idi.`,
    playingTo: (target) => `${target} xala qədər oynanılır.`,
    openerNote: (previousWinner) =>
      previousWinner === null
        ? 'Son oyun bərabərə bitdi, ona görə istənilən tərəf aça bilər.'
        : previousWinner === 'us'
          ? 'Son oyunu siz qazandınız — sizin komanda açır.'
          : 'Son oyunu onlar qazandı — onların komandası açır.',
    airLabel: 'Havada:',
    airYou: (points) => `sizdə ${points}`,
    airThem: (points) => `onlarda ${points}`,
    airExplain: (threshold) =>
      `Qazanılıb, amma yazılmayıb — ${threshold} və ya daha çox xallı qələbə sizinkiləri lövhəyə ` +
      `yazır, rəqibin havadakı xallarını isə silir.`,
    potNote: (pot) =>
      `Sekadan bankda ${pot} xal var — növbəti oyunu qazanan onları da götürür.`,
    intro: (target, threshold) =>
      `Matç ${target} xala qədər gedir. Oyunu qazanan komanda rəqiblərin əlində qalan xalları ` +
      `yazır — amma ${threshold} xaldan az dəyəri olan qələbə dərhal yazılmır: sonrakı ` +
      `${threshold} və ya daha böyük qələbə onu lövhəyə yazana qədər havada qalır.`,
    startGame: 'Oyuna başla',
    startNumberedGame: (game) => `${ordinal(game)} oyuna başla`,
    resetMatch: 'Matçı sıfırla',
    newMatch: 'Yeni matç',
  },

  newGame: {
    handHeading: 'Daşlarınızı seçin',
    handCount: (selected, total) => `Sizə paylanan ${total} daşı seçin (${selected}/${total})`,
    handRuleHint:
      'Bir əldə eyni rəqəmdən ən çox 4 daş ola bilər, o rəqəmin cütü də əldədirsə — 5.',
    next: 'Növbəti: kim açır',
    openerHeading: 'Kim açır?',
    openerStatus: (game, target, us, them) =>
      `${ordinal(game)} oyun · ${target} xala qədər · siz ${us}–${them} onlar`,
    seatNote: (role, seat) => `${role} · ${seat} yeri`,
    forcedStone: (stoneId) =>
      `Açılış daşı dəyişməzdir: ${stoneId} — onu ilk gediş kimi qeyd edin.`,
    start: 'Oyuna başla',
  },

  game: {
    heading: (game) => `${ordinal(game)} oyun`,
    header: ({ me, partner, opponents, us, them, opener }) =>
      `Siz ${me} · Tərəfdaş ${partner} · Rəqiblər ${opponents} · Hesab ${us}–${them} · ` +
      `${opener} açdı`,
    impossibleLog:
      'Bu gedişlər siyahısına uyğun gələn qanuni paylanma yoxdur — çox güman ki, nəsə səhv ' +
      'qeyd olunub. Son gedişi geri alıb yoxlayın. Düzələnə qədər tövsiyələr sadə sayma ' +
      'üsuluna keçir.',
    seka: 'Seka — heç kim xal yazmır',
    weScore: (points) => `Sizin komanda ${points} xal yazır`,
    theyScore: (points) => `Rəqib komanda ${points} xal yazır`,
    wentOut: (name, team) =>
      `${genitive(name)} daşları qurtardı, ona görə ${team} rəqiblərin əlində qalan xalları ` +
      `götürür.`,
    blocked:
      'Oyun bağlandı — əlində daha az xal qalan komanda qazanır və rəqiblərin xallarını yazır.',
    pipsHeld: ({ usTeam, usPips, themTeam, themPips }) =>
      `Sizin komandanın (${usTeam}) əlində ${usPips} xal qaldı · rəqib komandanın ` +
      `(${themTeam}) əlində ${themPips} xal`,
    potCollected: (pot) => `Seka bankından götürülən ${pot} xal da daxil olmaqla.`,
    sekaCarry: (carry) =>
      `İki komanda bərabərdir, ona görə ${carry} xal növbəti qalibin bankına gedir.`,
    wroteWithAir: (threshold, collected) =>
      `${threshold} xaldan çoxdur, ona görə lövhəyə yazılır — havada qalan ${collected} xalla ` +
      `birlikdə.`,
    wrote: (threshold) => `${threshold} xaldan çoxdur, ona görə birbaşa lövhəyə yazılır.`,
    notWritten: (threshold) =>
      `${threshold} xaldan azdır, ona görə heç nə yazılmır — ${threshold} və ya daha böyük ` +
      `qələbə onu lövhəyə yazana qədər havada qalır.`,
    wiped: (points) => ` Onların havadakı ${points} xalı silinir.`,
    matchStanding: (us, them, target) =>
      `Matç: siz ${us} – ${them} onlar, ${target} xala qədər`,
    airStanding: (us, them) => ` · havada: sizdə ${us}, onlarda ${them}`,
    recordScore: 'Xalları yaz və matçı davam et',
    nothingFits: 'Əlinizdə uclara uyğun gələn daş yoxdur — pas qeyd edin.',
    engineFailed: () =>
      'Qanuni gedişiniz var, amma mühərrik variantları sıralaya bilmədi. Ən yaxşı bildiyiniz ' +
      'daşı oynayın — pas verməyin.',
    undo: 'Son gedişi geri al',
    abandon: 'Oyunu tərk et',
  },

  table: {
    waitingFirstStone: 'İlk daş gözlənilir',
    placeHere: (stone) => `${stone} daşını buraya qoy`,
    tap: 'toxun',
    mismatch: (stone) =>
      `${stone} açıq uclardan heç birinə uyğun gəlmir. Başqa daş seçin və ya pas qeyd edin.`,
  },

  logger: {
    myHint: 'Öz sıranızdan bir daşa toxunun, sonra masadakı işıqlanan uca toxunun.',
    myForcedHint: (stoneId) =>
      `${stoneId} ilə açmalısınız — ona toxunun, sonra masaya toxunun.`,
    turnHeading: (name) => `${genitive(name)} növbəsi`,
    forcedOpen: (name, stoneId) =>
      `${name} ${stoneId} ilə açır — gedişi qeyd etmək üçün ona toxunun.`,
    selectPlayed: (name) => `${genitive(name)} masaya qoyduğu daşı seçin:`,
    hiddenNotice: (hidden, name) =>
      `${hidden} daş göstərilmir — gedişlər siyahısına görə onlar ${genitive(name)} əlində ` +
      `ola bilməz.`,
    allRuledOut: (name) =>
      `Uclara uyğun gələn bütün daşlar ${genitive(name)} əlindən çıxıb, deməli ${name} pas ` +
      `verməlidir.`,
    noneMatch: (name) =>
      `Qalan daşların heç biri açıq uclara uyğun gəlmir — ${name} pas verməlidir.`,
    passButton: (name) => `${name} pas verir / oynaya bilmir`,
  },

  history: {
    heading: 'Gedişlər',
    passed: 'pas verdi',
    played: (stone, side) => `${stone}${side ? ` (${side})` : ''} oynadı`,
    onEnds: (ends) => `${ends} üzərində`,
    emptyTable: 'boş masa',
  },

  reveal: {
    headingBlocked: 'Oyun bağlandı — xalları hesablamaq üçün qalan daşları daxil edin',
    headingWentOut: 'Oyun bitdi — xalları hesablamaq üçün qalan daşları daxil edin',
    selectFor: (name, selected, total) =>
      `${genitive(name)} əlində qalan daşları seçin (${selected}/${total})`,
    hiddenNotice: (hidden) =>
      `${hidden} daş göstərilmir — gedişlər siyahısına görə onlar burada ola bilməz.`,
    nextFor: (name) => `Növbəti: ${genitive(name)} daşları`,
    leftoverFor: (name, count, total) =>
      `Qalan daşlar ${dative(name)} gedir (${count}/${total})`,
    finish: 'Bitir və hesabla',
  },

  recommendations: {
    heading: 'Tövsiyə',
    searching: 'Axtarılır…',
    basis: (deals) => `${deals} simulyasiya paylanması üzrə`,
    searchingShort: 'axtarılır…',
    rank: (index) => (index === 0 ? 'Ən yaxşı' : ordinal(index + 1)),
    placementOpening: (stone, left, right) => `${stone} ilə aç — uclar ${left} | ${right} qalır`,
    placementOnSide: (stone, side, left, right) =>
      `${stone} — ${side} uca, uclar ${left} | ${right} qalır`,
    proven: 'dəqiq',
    solved: 'həll olundu',
    expectedPoints: 'gözlənilən xal',
    winRate: (percent) => `${percent}% qələbə`,
    weakerHidden: (count) => `${count} daha zəif gediş göstərilmir.`,
  },

  reasons: {
    andJoin: ' və ',
    lastStone: 'Bu sizin son daşınızdır — onu oynamaqla oyunu bitirib qazanırsınız.',
    lastStoneShort: 'Son daş.',
    forcedBlockGood: (values, points) =>
      `Oyunu tamamilə bağlayır: bütün ${values} daşları masadadır, ona görə dörd oyunçu da pas ` +
      `verir. Sizin komanda daha yüngüldür — təxminən ${points} xal dəyərində.`,
    forcedBlockBad: (values, points) =>
      `Oyunu ${values} üzərində bağlayır, amma ağır tərəf sizin komandadır — bu, rəqibə təxminən ` +
      `${points} xal verər.`,
    suitControl: (playable, remaining) =>
      `Açıq uclarda hələ ${playable} daşınız oynanıla bilir (əlinizdə ${remaining} daş qalır).`,
    selfBlockNone:
      'Əlinizdə heç nə uclara uyğun gəlmir — növbəti gedişdə çox güman ki, pas verməli olacaqsınız.',
    selfBlockThin: 'Yalnız bir daşınız uyğun gəlir — bir pis ucdan sonra pas verəcəksiniz.',
    stuckPassed: (name, values) =>
      `${name} artıq ${values} üzərində pas verib, deməli yenə pas verməlidir.`,
    stuckRuledOut: (name, values) =>
      `${values} uclarına uyğun daş ${genitive(name)} əlində ola bilməz — gedişlər siyahısı bunu ` +
      `istisna edir.`,
    starveLikely: (name, percent) =>
      `${name} çox güman ki, buna cavab verə bilməz — pas ehtimalı təxminən ${percent}%.`,
    partnerShutOut: (name) =>
      `Bu, tərəfdaşınız ${accusative(name)} bağlayır — o cavab verə bilməyəcək.`,
    feedPartnerAhead: (name, ahead) =>
      `${name} çox güman ki, bu uca cavab verə bilər — üstəlik o, çıxmağa sizdən ${ahead} daş ` +
      `yaxındır, ona görə onun əlini boşaltmaq daha faydalıdır.`,
    feedPartner: (name) => `Tərəfdaşınız ${name} çox güman ki, bu uca cavab verə bilər.`,
    partnerSuit: (name, stones, values) =>
      `${name} artıq ${values} olan ${stones} daş oynayıb, deməli bu, onun güclü rəqəmidir — ` +
      `ucu açıq saxlamağa dəyər.`,
    pipShed: (pips) => `Komandanızın əlindəki xalları ${pips} azaldır.`,
    deadDouble: (stone, value) =>
      `${stone} daşınızı əlinizdə qoyur: nə masada, nə də əllərdə başqa ${value} qalmayıb.`,
    thinDouble: (stone, value, outside) =>
      `${stone} daşınızı yerləşdirmək çətinləşir — hesaba alınmayan yalnız ${outside} başqa ` +
      `${value} qalıb.`,
  },

  a11y: {
    stone: (label) => `${label} domino daşı`,
  },

  opening: {
    orJoin: ' və ya ',
    iHoldItFirstGame:
      '1-1 sizə düşüb, ona görə birinci oyunu siz açırsınız və məhz onu oynamalısınız.',
    iHoldItAgain: 'Lövhədə hələ heç nə yoxdur, ona görə yenə 1-1 açır — və o, sizə düşüb.',
    whoHoldsItFirstGame: 'Birinci oyun 1-1 ilə açılır. O kimə düşdü?',
    whoHoldsItAgain:
      'Lövhədə hələ heç nə yoxdur, ona görə bu oyun da 1-1 ilə açılır. O kimə düşdü?',
    afterSeka: 'Son oyun seka oldu, qalibi olmadı — bu oyunu kimin açdığını qeyd edin.',
    weWon: (names) => `Son oyunu sizin komanda qazandı, ona görə ${names} istənilən daşla açır.`,
    theyWon: (names) => `Son oyunu rəqib komanda qazandı, ona görə ${names} istənilən daşla açır.`,
  },
};
