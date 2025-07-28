import { Card, Hand } from '@/app/page'

type Player = {
  name: string;
  hand: Card[];
}

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const

// card value mapping
const VALUE_RANK: { [key: string]: number } = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14
}

type HandRank = {
  rank: number;
  value: number[]; 
}

function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value })
    }
  }
  return deck
}

function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

function getRemainingCards(hand: Hand): Card[] {
  const usedCards = [...hand.hero, ...hand.villain, ...hand.board]
  return createDeck().filter(
    card => !usedCards.some(
      used => used.suit === card.suit && used.value === card.value
    )
  )
}

function evaluateHand(cards: Card[]): HandRank {
  
  // counts occurrences of each value
  const valueCounts: { [key: string]: number } = {}
  const suitCounts: { [key: string]: number } = {}
  
  for (const card of cards) {
    valueCounts[card.value] = (valueCounts[card.value] || 0) + 1
    suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1
  }

  // checks for flush
  const isFlush = Object.values(suitCounts).some(count => count >= 5)
  
  // checks for straight
  const uniqueValues = Array.from(new Set(cards.map(card => VALUE_RANK[card.value]))).sort((a, b) => b - a)
  let isStraight = false
  let straightHighCard = 0
  
  // checks for ace-low straight 
  if (uniqueValues.includes(14) && 
      uniqueValues.includes(5) &&
      uniqueValues.includes(4) &&
      uniqueValues.includes(3) &&
      uniqueValues.includes(2)) {
    isStraight = true
    straightHighCard = 5
  }
  
  // checks for regular straights
  for (let i = 0; i <= uniqueValues.length - 5; i++) {
    if (uniqueValues[i] - uniqueValues[i + 4] === 4) {
      isStraight = true
      straightHighCard = uniqueValues[i]
      break
    }
  }

  // checks for straight flush
  if (isStraight && isFlush) {
    return { rank: 9, value: [straightHighCard] }
  }

  // checks for quads
  const fourOfAKind = Object.entries(valueCounts).find(([_, count]) => count === 4)
  if (fourOfAKind) {
    const kicker = Object.entries(valueCounts)
      .filter(([value, count]) => count === 1)
      .map(([value]) => VALUE_RANK[value])
      .sort((a, b) => b - a)[0]
    return { rank: 8, value: [VALUE_RANK[fourOfAKind[0]], kicker] }
  }

  // checks for full house
  const threeOfAKind = Object.entries(valueCounts).find(([_, count]) => count === 3)
  const pair = Object.entries(valueCounts).find(([_, count]) => count === 2)
  if (threeOfAKind && pair) {
    return { rank: 7, value: [VALUE_RANK[threeOfAKind[0]], VALUE_RANK[pair[0]]] }
  }

  // checks for flush
  if (isFlush) {
    const flushValues = cards
      .filter(card => suitCounts[card.suit] >= 5)
      .map(card => VALUE_RANK[card.value])
      .sort((a, b) => b - a)
      .slice(0, 5)
    return { rank: 6, value: flushValues }
  }

  // checks for straight
  if (isStraight) {
    return { rank: 5, value: [straightHighCard] }
  }

  // checks for trips
  if (threeOfAKind) {
    const kickers = Object.entries(valueCounts)
      .filter(([value, count]) => count === 1)
      .map(([value]) => VALUE_RANK[value])
      .sort((a, b) => b - a)
      .slice(0, 2)
    return { rank: 4, value: [VALUE_RANK[threeOfAKind[0]], ...kickers] }
  }

  // checks for two pair
  const pairs = Object.entries(valueCounts)
    .filter(([_, count]) => count === 2)
    .map(([value]) => VALUE_RANK[value])
    .sort((a, b) => b - a)
  if (pairs.length >= 2) {
    const kicker = Object.entries(valueCounts)
      .filter(([value, count]) => count === 1)
      .map(([value]) => VALUE_RANK[value])
      .sort((a, b) => b - a)[0]
    return { rank: 3, value: [pairs[0], pairs[1], kicker] }
  }

  // checks for pair
  if (pairs.length === 1) {
    const kickers = Object.entries(valueCounts)
      .filter(([value, count]) => count === 1)
      .map(([value]) => VALUE_RANK[value])
      .sort((a, b) => b - a)
      .slice(0, 3)
    return { rank: 2, value: [pairs[0], ...kickers] }
  }

  // high card
  return { rank: 1, value: uniqueValues.slice(0, 5) }
}

function compareHands(heroRank: HandRank, villainRank: HandRank): number {
  if (heroRank.rank !== villainRank.rank) {
    return heroRank.rank - villainRank.rank
  }
  
  for (let i = 0; i < heroRank.value.length; i++) {
    if (heroRank.value[i] !== villainRank.value[i]) {
      return heroRank.value[i] - villainRank.value[i]
    }
  }
  
  return 0
}

export async function calculateOdds(hand: Hand): Promise<{ hero: number; villain: number; tie: number }> {
  const SIMULATIONS = 10000
  let heroWins = 0
  let villainWins = 0
  let ties = 0

  for (let i = 0; i < SIMULATIONS; i++) {
    const remainingCards = getRemainingCards(hand)
    const shuffled = shuffleDeck(remainingCards)
    
    const board = [...hand.board]
    while (board.length < 5) {
      board.push(shuffled.pop()!)
    }

    const heroHand = [...hand.hero, ...board]
    const villainHand = [...hand.villain, ...board]
    
    const heroRank = evaluateHand(heroHand)
    const villainRank = evaluateHand(villainHand)
    const comparison = compareHands(heroRank, villainRank)

    if (comparison > 0) {
      heroWins++
    } else if (comparison < 0) {
      villainWins++
    } else {
      ties++
    }
  }

  return {
    hero: (heroWins / SIMULATIONS) * 100,
    villain: (villainWins / SIMULATIONS) * 100,
    tie: (ties / SIMULATIONS) * 100
  }
}

export type PlayerOdds = {
  [key: string]: number;
  tie: number;
}

export async function calculateMultiPlayerOdds(players: (Player | null)[], board: Card[]): Promise<PlayerOdds> {
  const SIMULATIONS = 10000;
  const activePlayers = players.filter((p): p is Player => p !== null && p.hand.length === 2);
  if (activePlayers.length === 0) return { tie: 100 };

  const results: PlayerOdds = { tie: 0 };
  activePlayers.forEach(player => results[player.name] = 0);

  for (let i = 0; i < SIMULATIONS; i++) {
    const remainingCards = createDeck().filter(
      card => !board.some(b => b.suit === card.suit && b.value === card.value) &&
              !activePlayers.some(p => p.hand.some((h: Card) => h.suit === card.suit && h.value === card.value))
    );
    const shuffled = shuffleDeck(remainingCards);
    
    const completeBoard = [...board];
    while (completeBoard.length < 5) {
      completeBoard.push(shuffled.pop()!);
    }

    const playerHands = activePlayers.map(player => ({
      name: player.name,
      rank: evaluateHand([...player.hand, ...completeBoard])
    }));

    // sorts by hand rank
    playerHands.sort((a, b) => {
      if (a.rank.rank !== b.rank.rank) return b.rank.rank - a.rank.rank;
      for (let i = 0; i < a.rank.value.length; i++) {
        if (a.rank.value[i] !== b.rank.value[i]) return b.rank.value[i] - a.rank.value[i];
      }
      return 0;
    });

    // checks for ties
    const bestRank = playerHands[0].rank;
    const winners = playerHands.filter(p => 
      p.rank.rank === bestRank.rank && 
      p.rank.value.every((v, i) => v === bestRank.value[i])
    );

    if (winners.length > 1) {
      results.tie += winners.length;
    } else {
      results[winners[0].name]++;
    }
  }

  // Convert to percentages
  Object.keys(results).forEach(key => {
    results[key] = (results[key] / SIMULATIONS) * 100;
  });

  return results;
} 