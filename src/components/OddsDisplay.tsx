'use client'

import {
  Box,
  Progress,
  Text,
  VStack,
  HStack,
  useColorModeValue,
} from '@chakra-ui/react'
import { Hand } from '@/app/page'
import { useEffect, useState } from 'react'
import { calculateOdds } from '@/lib/odds'

interface Odds {
  hero: number
  villain: number
  tie: number
}

export function OddsDisplay({ hand }: { hand: Hand }) {
  const [odds, setOdds] = useState<Odds>({ hero: 0, villain: 0, tie: 0 })
  const bgColor = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')

  useEffect(() => {
    const calculateAndUpdateOdds = async () => {
      if (hand.hero.length === 2 && hand.villain.length === 2) {
        const calculatedOdds = await calculateOdds(hand)
        setOdds(calculatedOdds)
      } else {
        setOdds({ hero: 0, villain: 0, tie: 0 })
      }
    }

    calculateAndUpdateOdds()
  }, [hand])

  return (
    <Box p={6} bg={bgColor} borderRadius="lg" borderWidth={1} borderColor={borderColor}>
      <VStack spacing={4} align="stretch">
        <Text fontSize="xl" fontWeight="bold">Win Probabilities</Text>

        <VStack spacing={2} align="stretch">
          <HStack justify="space-between">
            <Text>Hero</Text>
            <Text fontWeight="bold">{odds.hero.toFixed(1)}%</Text>
          </HStack>
          <Progress
            value={odds.hero}
            colorScheme="blue"
            borderRadius="full"
            size="lg"
          />
        </VStack>

        <VStack spacing={2} align="stretch">
          <HStack justify="space-between">
            <Text>Villain</Text>
            <Text fontWeight="bold">{odds.villain.toFixed(1)}%</Text>
          </HStack>
          <Progress
            value={odds.villain}
            colorScheme="red"
            borderRadius="full"
            size="lg"
          />
        </VStack>

        <VStack spacing={2} align="stretch">
          <HStack justify="space-between">
            <Text>Tie</Text>
            <Text fontWeight="bold">{odds.tie.toFixed(1)}%</Text>
          </HStack>
          <Progress
            value={odds.tie}
            colorScheme="gray"
            borderRadius="full"
            size="lg"
          />
        </VStack>
      </VStack>
    </Box>
  )
} 