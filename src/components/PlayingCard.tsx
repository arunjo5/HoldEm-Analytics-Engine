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
      w="80px"
      h="100px"
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
      transition="all 0.2s ease-in-out"
      _hover={{
        transform: 'translateY(-2px) rotate(1deg)',
        boxShadow: 'md',
        borderColor: 'gray.300'
      }}
      sx={{
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: 'md',
          background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 100%)',
          pointerEvents: 'none'
        }
      }}
    >
      <Box>
        <Text
          fontSize="lg"
          fontWeight="bold"
          color={color}
          lineHeight={1}
          textShadow="0 1px 2px rgba(0,0,0,0.1)"
          transition="all 0.2s ease-in-out"
        >
          {value}
        </Text>
        <Text
          fontSize="xl"
          color={color}
          lineHeight={1}
          textShadow="0 1px 2px rgba(0,0,0,0.1)"
          transition="all 0.2s ease-in-out"
        >
          {symbol}
        </Text>
      </Box>

      <Box
        position="absolute"
        bottom={2}
        right={2}
        transform="rotate(180deg)"
        transition="all 0.2s ease-in-out"
      >
        <Text
          fontSize="lg"
          fontWeight="bold"
          color={color}
          lineHeight={1}
          textShadow="0 1px 2px rgba(0,0,0,0.1)"
        >
          {value}
        </Text>
        <Text
          fontSize="xl"
          color={color}
          lineHeight={1}
          textShadow="0 1px 2px rgba(0,0,0,0.1)"
        >
          {symbol}
        </Text>
      </Box>

      <Box
        position="absolute"
        top="50%"
        left="50%"
        transform="translate(-50%, -50%)"
        opacity={0.1}
        pointerEvents="none"
      >
        <Text
          fontSize="4xl"
          color={color}
          fontWeight="bold"
        >
          {symbol}
        </Text>
      </Box>
    </Box>
  )
} 