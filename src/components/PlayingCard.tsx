'use client'

import { Box, Text } from '@chakra-ui/react'
import { Card } from '@/app/page'

interface PlayingCardProps {
  card: Card
}

const SUIT_SYMBOLS = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠'
}

const SUIT_COLORS = {
  hearts: 'red.500',
  diamonds: 'red.500',
  clubs: 'gray.800',
  spades: 'gray.800'
}

export function PlayingCard({ card }: PlayingCardProps) {
  const { suit, value } = card
  const symbol = SUIT_SYMBOLS[suit]
  const color = SUIT_COLORS[suit]

  return (
    <Box
      w="60px"
      h="90px"
      bg="white"
      borderRadius="md"
      borderWidth={1}
      borderColor="gray.200"
      p={2}
      position="relative"
      boxShadow="sm"
      display="flex"
      flexDirection="column"
      justifyContent="space-between"
    >
      <Box>
        <Text
          fontSize="lg"
          fontWeight="bold"
          color={color}
          lineHeight={1}
        >
          {value}
        </Text>
        <Text
          fontSize="xl"
          color={color}
          lineHeight={1}
        >
          {symbol}
        </Text>
      </Box>

      <Box
        position="absolute"
        bottom={2}
        right={2}
        transform="rotate(180deg)"
      >
        <Text
          fontSize="lg"
          fontWeight="bold"
          color={color}
          lineHeight={1}
        >
          {value}
        </Text>
        <Text
          fontSize="xl"
          color={color}
          lineHeight={1}
        >
          {symbol}
        </Text>
      </Box>
    </Box>
  )
} 