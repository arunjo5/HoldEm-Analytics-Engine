'use client'

import { Box, Container, Heading, VStack, HStack, IconButton, useColorMode, useColorModeValue, Tooltip, Flex } from '@chakra-ui/react'
import { Table } from '@/components/Table'
import { PlayerOddsDisplay } from '@/components/PlayerOddsDisplay'
import { useState } from 'react'
import { MoonIcon, SunIcon } from '@chakra-ui/icons'

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
  const [board, setBoard] = useState<Card[]>([])

  const handlePlayerChange = (index: number, player: Player | null) => {
    setPlayers(prev => {
      const updated = [...prev]
      updated[index] = player
      return updated
    })
  }

  const handleBoardChange = (cards: Card[]) => {
    setBoard(cards)
  }

  const containerBg = useColorModeValue('gray.50', 'gray.900');
  const headingColor = useColorModeValue('gray.800', 'white');

  return (
    <Box minH="100vh" bg={containerBg}>
      <ColorModeToggle />
      <Container maxW="container.xl" py={8}>
        <VStack spacing={8}>
          <Box w="full" textAlign="center">
            <Heading color={headingColor}>Hold&apos;Em Odds Calculator</Heading>
          </Box>
          <Flex w="full" direction="column" align="center" justify="center">
            <Table players={players} onPlayerChange={handlePlayerChange} board={board} onBoardChange={handleBoardChange} />
            <PlayerOddsDisplay players={players} board={board} />
          </Flex>
        </VStack>
      </Container>
    </Box>
  )
}

function ColorModeToggle() {
  const { colorMode, toggleColorMode } = useColorMode();
  return (
    <Tooltip label={useColorModeValue('Switch to dark mode', 'Switch to light mode')}>
      <IconButton
        aria-label="Toggle night mode"
        icon={colorMode === 'light' ? <MoonIcon /> : <SunIcon />}
        onClick={toggleColorMode}
        variant="solid"
        size="lg"
        isRound
        boxShadow="lg"
        position="fixed"
        top="24px"
        right="32px"
        zIndex={1000}
        bg={useColorModeValue('white', 'gray.800')}
        color={useColorModeValue('gray.800', 'white')}
        _hover={{ bg: useColorModeValue('gray.200', 'gray.700') }}
        _active={{ bg: useColorModeValue('gray.300', 'gray.600') }}
        _focus={{ boxShadow: 'outline' }}
      />
    </Tooltip>
  );
} 