'use client'

import { Box, Container, Heading, VStack } from '@chakra-ui/react'
import { CardSelector } from '@/components/CardSelector'
import { OddsDisplay } from '@/components/OddsDisplay'
import { useState } from 'react'

export type Card = {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades'
  value: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'
}

export type Hand = {
  hero: Card[]
  villain: Card[]
  board: Card[]
}

export default function Home() {
  const [hand, setHand] = useState<Hand>({
    hero: [],
    villain: [],
    board: []
  })

  return (
    <Container maxW="container.xl" py={8}>
      <VStack spacing={8}>
        <Heading>Hold'Em Odds Calculator</Heading>
        
        <Box w="full">
          <CardSelector
            hand={hand}
            onHandChange={setHand}
          />
        </Box>

        <Box w="full">
          <OddsDisplay hand={hand} />
        </Box>
      </VStack>
    </Container>
  )
} 