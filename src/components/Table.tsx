import React, { useState } from 'react';
import { Box, Button, VStack, HStack, Text } from '@chakra-ui/react';
import { Card } from '@/app/page';
import { PlayingCard } from './PlayingCard';

interface Player {
  name: string;
  hand: Card[];
}

interface TableProps {
  players: (Player | null)[];
  onPlayerChange: (index: number, player: Player | null) => void;
}

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export function Table({ players, onPlayerChange }: TableProps) {
  const seatCount = 9;
  const radiusX = 230;
  const radiusY = 150;
  const centerX = 300;
  const centerY = 200;
  const [activeSeat, setActiveSeat] = useState<number | null>(null);

  // Get all used cards
  const usedCards = players
    .filter(Boolean)
    .flatMap(player => player!.hand);

  const isCardUsed = (card: Card, seatIndex: number) => {
    // Allow player to re-select their own cards
    return usedCards.some(
      c => c.suit === card.suit && c.value === card.value &&
      (!players[seatIndex] || !players[seatIndex]!.hand.some(
        h => h.suit === card.suit && h.value === card.value
      ))
    );
  };

  const handleCardClick = (seatIndex: number, card: Card) => {
    const player = players[seatIndex];
    if (!player) return;
    const hand = [...player.hand];
    const idx = hand.findIndex(c => c.suit === card.suit && c.value === card.value);
    if (idx !== -1) {
      hand.splice(idx, 1);
    } else if (hand.length < 2 && !isCardUsed(card, seatIndex)) {
      hand.push(card);
    }
    onPlayerChange(seatIndex, { ...player, hand });
  };

  return (
    <Box position="relative" w="600px" h="400px" mx="auto">
      {/* Poker Table Felt */}
      <Box
        position="absolute"
        left={0}
        top={0}
        w="600px"
        h="400px"
        borderRadius="200px / 130px"
        bgGradient="linear(to-b, green.700 80%, green.900)"
        border="12px solid #b8864b"
        boxShadow="0 0 40px 0 #222"
        zIndex={0}
      />
      {/* Seats */}
      {Array.from({ length: seatCount }).map((_, i) => {
        const angle = (2 * Math.PI * i) / seatCount - Math.PI / 2;
        const x = centerX + radiusX * Math.cos(angle) - 48;
        const y = centerY + radiusY * Math.sin(angle) - 48;
        const player = players[i];
        return (
          <VStack
            key={i}
            position="absolute"
            left={`${x}px`}
            top={`${y}px`}
            spacing={1}
            align="center"
            zIndex={2}
          >
            <Box
              bg="white"
              borderRadius="lg"
              boxShadow="md"
              borderWidth={player ? 2 : 1}
              borderColor={player ? 'blue.400' : 'gray.300'}
              px={3}
              py={2}
              minW="90px"
              minH="70px"
              display="flex"
              flexDirection="column"
              alignItems="center"
              justifyContent="center"
            >
              {player ? (
                <>
                  <HStack mb={1}>
                    {player.hand.map((card, idx) => (
                      <PlayingCard key={idx} card={card} />
                    ))}
                  </HStack>
                  <Button size="xs" colorScheme="blue" mb={1} onClick={() => setActiveSeat(i)}>
                    {player.hand.length < 2 ? 'Pick Cards' : 'Edit Cards'}
                  </Button>
                  <Button size="xs" colorScheme="red" variant="outline" onClick={() => onPlayerChange(i, null)}>
                    Remove
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  borderRadius="md"
                  borderColor="gray.400"
                  borderWidth={2}
                  boxShadow="sm"
                  bg="white"
                  color="gray.700"
                  _hover={{ bg: 'gray.100', borderColor: 'blue.400' }}
                  onClick={() => onPlayerChange(i, { name: `Player ${i + 1}`, hand: [] })}
                >
                  + Add
                </Button>
              )}
            </Box>
            <Text fontSize="sm" color="white" fontWeight="bold" mt={1} textShadow="0 1px 4px #222">
              {player ? player.name : `Player ${i + 1}`}
            </Text>
            {/* Card Picker */}
            {activeSeat === i && player && (
              <Box bg="white" p={2} borderRadius="md" boxShadow="lg" zIndex={10} mt={2} minW="320px">
                <HStack spacing={1} wrap="wrap" flexWrap="wrap">
                  {VALUES.map(value =>
                    SUITS.map(suit => {
                      const card: Card = { suit, value };
                      const selected = player.hand.some(
                        c => c.suit === card.suit && c.value === card.value
                      );
                      const used = isCardUsed(card, i);
                      return (
                        <Box
                          key={`${value}-${suit}`}
                          onClick={() => handleCardClick(i, card)}
                          cursor={used && !selected ? 'not-allowed' : 'pointer'}
                          opacity={used && !selected ? 0.3 : selected ? 0.5 : 1}
                          _hover={{ opacity: used && !selected ? 0.3 : 0.7 }}
                        >
                          <PlayingCard card={card} />
                        </Box>
                      );
                    })
                  )}
                </HStack>
                <Button size="xs" mt={2} onClick={() => setActiveSeat(null)}>
                  Done
                </Button>
              </Box>
            )}
          </VStack>
        );
      })}
      {/* Table label */}
      <Box position="absolute" left="50%" top="50%" transform="translate(-50%, -50%)" color="white" fontWeight="bold" fontSize="2xl" zIndex={1} textShadow="0 2px 8px #222">
        Poker Table
      </Box>
    </Box>
  );
} 