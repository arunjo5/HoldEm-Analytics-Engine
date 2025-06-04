'use client'

import { Box, Container, Heading, VStack } from '@chakra-ui/react'
import { Table } from '@/components/Table'
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

type Player = {
  name: string;
  hand: Card[];
}

export default function Home() {
  const [players, setPlayers] = useState<(Player | null)[]>(Array(9).fill(null))

  const handlePlayerChange = (index: number, player: Player | null) => {
    setPlayers(prev => {
      const updated = [...prev]
      updated[index] = player
      return updated
    })
  }

  return (
    <Container maxW="container.xl" py={8}>
      <VStack spacing={8}>
        <Heading>Hold'Em Odds Calculator</Heading>
        <Box w="full">
          <Table players={players} onPlayerChange={handlePlayerChange} />
        </Box>
      </VStack>
    </Container>
  )
} 