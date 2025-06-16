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
    <Box 
      p={6} 
      bg={bgColor} 
      borderRadius="lg" 
      borderWidth={1} 
      borderColor={borderColor} 
      w="full" 
      maxW="800px" 
      mx="auto" 
      color={textColor}
      boxShadow="lg"
      transition="all 0.3s ease-in-out"
      _hover={{
        boxShadow: 'xl',
        transform: 'translateY(-2px)'
      }}
    >
      <VStack spacing={4} align="stretch">
        <Text 
          fontSize="2xl" 
          fontWeight="bold" 
          textAlign="center" 
          color={textColor}
          textShadow="0 1px 2px rgba(0,0,0,0.1)"
        >
          Win Probabilities
        </Text>
        
        {activePlayers.map((player, index) => (
          <VStack key={player.name} spacing={2} align="stretch">
            <HStack justify="space-between">
              <Text 
                color={textColor}
                fontWeight="medium"
                transition="all 0.2s ease-in-out"
                _hover={{
                  transform: 'translateX(4px)',
                  color: `${PLAYER_COLORS[index % PLAYER_COLORS.length]}.500`
                }}
              >
                {player.name}
              </Text>
              <Text 
                fontWeight="bold" 
                color={textColor}
                transition="all 0.2s ease-in-out"
                _hover={{
                  transform: 'scale(1.1)',
                  color: `${PLAYER_COLORS[index % PLAYER_COLORS.length]}.500`
                }}
              >
                {odds[player.name]?.toFixed(1)}%
              </Text>
            </HStack>
            <Progress
              value={odds[player.name] || 0}
              colorScheme={PLAYER_COLORS[index % PLAYER_COLORS.length]}
              borderRadius="full"
              size="md"
              transition="all 0.3s ease-in-out"
              sx={{
                '& > div': {
                  transition: 'all 0.3s ease-in-out'
                }
              }}
            />
          </VStack>
        ))}

        <VStack spacing={2} align="stretch">
          <HStack justify="space-between">
            <Text 
              color={textColor}
              fontWeight="medium"
              transition="all 0.2s ease-in-out"
              _hover={{
                transform: 'translateX(4px)',
                color: 'gray.500'
              }}
            >
              Tie
            </Text>
            <Text 
              fontWeight="bold" 
              color={textColor}
              transition="all 0.2s ease-in-out"
              _hover={{
                transform: 'scale(1.1)',
                color: 'gray.500'
              }}
            >
              {odds.tie.toFixed(1)}%
            </Text>
          </HStack>
          <Progress
            value={odds.tie}
            colorScheme="gray"
            borderRadius="full"
            size="md"
            transition="all 0.3s ease-in-out"
            sx={{
              '& > div': {
                transition: 'all 0.3s ease-in-out'
              }
            }}
          />
        </VStack>
      </VStack>
    </Box>
  );
} 