'use client'

import {
  Box,
  Progress,
  Text,
  VStack,
  HStack,
  useColorModeValue,
} from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { calculateMultiPlayerOdds, PlayerOdds } from '@/lib/odds'
import { Card } from '@/app/page'

interface Player {
  name: string;
  hand: Card[];
}

interface PlayerOddsDisplayProps {
  players: (Player | null)[];
  board: Card[];
}

const PLAYER_COLORS = [
  'blue',
  'red',
  'green',
  'purple',
  'orange',
  'teal',
  'pink',
  'cyan',
  'yellow'
];

export function PlayerOddsDisplay({ players, board }: PlayerOddsDisplayProps) {
  const [odds, setOdds] = useState<PlayerOdds>({ tie: 100 });
  const bgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  const textColor = useColorModeValue('gray.800', 'white');

  useEffect(() => {
    const calculateAndUpdateOdds = async () => {
      const calculatedOdds = await calculateMultiPlayerOdds(players, board);
      setOdds(calculatedOdds);
    };

    calculateAndUpdateOdds();
  }, [players, board]);

  const activePlayers = players.filter((p): p is Player => p !== null && p.hand.length === 2);

  return (
    <Box p={4} bg={bgColor} borderRadius="lg" borderWidth={1} borderColor={borderColor} w="full" maxW="800px" mx="auto" color={textColor}>
      <VStack spacing={3} align="stretch">
        <Text fontSize="xl" fontWeight="bold" textAlign="center" color={textColor}>Win Probabilities</Text>
        
        {activePlayers.map((player, index) => (
          <VStack key={player.name} spacing={1} align="stretch">
            <HStack justify="space-between">
              <Text color={textColor}>{player.name}</Text>
              <Text fontWeight="bold" color={textColor}>{odds[player.name]?.toFixed(1)}%</Text>
            </HStack>
            <Progress
              value={odds[player.name] || 0}
              colorScheme={PLAYER_COLORS[index % PLAYER_COLORS.length]}
              borderRadius="full"
              size="md"
            />
          </VStack>
        ))}

        <VStack spacing={1} align="stretch">
          <HStack justify="space-between">
            <Text color={textColor}>Tie</Text>
            <Text fontWeight="bold" color={textColor}>{odds.tie.toFixed(1)}%</Text>
          </HStack>
          <Progress
            value={odds.tie}
            colorScheme="gray"
            borderRadius="full"
            size="md"
          />
        </VStack>
      </VStack>
    </Box>
  );
} 