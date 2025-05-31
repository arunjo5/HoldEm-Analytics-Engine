'use client'

import {
  Box,
  Grid,
  Heading,
  VStack,
  HStack,
  Text,
  useColorModeValue,
  ButtonGroup,
  Button,
} from '@chakra-ui/react'
import { Card, Hand } from '@/app/page'
import { PlayingCard } from './PlayingCard'
import { useState } from 'react'

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const

interface CardSelectorProps {
  hand: Hand
  onHandChange: (hand: Hand) => void
}

export function CardSelector({ hand, onHandChange }: CardSelectorProps) {
  const bgColor = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const [selectedSection, setSelectedSection] = useState<keyof Hand>('hero')

  const handleCardClick = (card: Card, section: keyof Hand) => {
    const newHand = { ...hand }
    const sectionCards = [...hand[section]]
    
    const cardIndex = sectionCards.findIndex(
      c => c.suit === card.suit && c.value === card.value
    )

    if (cardIndex === -1) {
      // Add card if section isn't full
      if (section === 'board' && sectionCards.length < 5) {
        sectionCards.push(card)
      } else if (section !== 'board' && sectionCards.length < 2) {
        sectionCards.push(card)
      }
    } else {
      // Remove card if clicked again
      sectionCards.splice(cardIndex, 1)
    }

    newHand[section] = sectionCards
    onHandChange(newHand)
  }

  const isCardSelected = (card: Card, section: keyof Hand) => {
    return hand[section].some(c => c.suit === card.suit && c.value === card.value)
  }

  return (
    <VStack spacing={6} align="stretch">
      <Box p={6} bg={bgColor} borderRadius="lg" borderWidth={1} borderColor={borderColor}>
        <VStack spacing={4} align="stretch">
          <Heading size="md">Hero's Cards</Heading>
          <HStack spacing={4}>
            {hand.hero.map((card, index) => (
              <PlayingCard key={index} card={card} />
            ))}
          </HStack>
        </VStack>
      </Box>

      <Box p={6} bg={bgColor} borderRadius="lg" borderWidth={1} borderColor={borderColor}>
        <VStack spacing={4} align="stretch">
          <Heading size="md">Villain's Cards</Heading>
          <HStack spacing={4}>
            {hand.villain.map((card, index) => (
              <PlayingCard key={index} card={card} />
            ))}
          </HStack>
        </VStack>
      </Box>

      <Box p={6} bg={bgColor} borderRadius="lg" borderWidth={1} borderColor={borderColor}>
        <VStack spacing={4} align="stretch">
          <Heading size="md">Board Cards</Heading>
          <HStack spacing={4}>
            {hand.board.map((card, index) => (
              <PlayingCard key={index} card={card} />
            ))}
          </HStack>
        </VStack>
      </Box>

      <Box p={6} bg={bgColor} borderRadius="lg" borderWidth={1} borderColor={borderColor}>
        <VStack spacing={4} align="stretch">
          <Heading size="md">Select Cards</Heading>
          
          <ButtonGroup size="sm" isAttached variant="outline">
            <Button
              onClick={() => setSelectedSection('hero')}
              colorScheme={selectedSection === 'hero' ? 'blue' : 'gray'}
            >
              Hero's Cards
            </Button>
            <Button
              onClick={() => setSelectedSection('villain')}
              colorScheme={selectedSection === 'villain' ? 'blue' : 'gray'}
            >
              Villain's Cards
            </Button>
            <Button
              onClick={() => setSelectedSection('board')}
              colorScheme={selectedSection === 'board' ? 'blue' : 'gray'}
            >
              Board Cards
            </Button>
          </ButtonGroup>

          <Grid templateColumns="repeat(13, 1fr)" gap={2}>
            {VALUES.map(value => (
              SUITS.map(suit => {
                const card: Card = { suit, value }
                return (
                  <Box
                    key={`${value}-${suit}`}
                    onClick={() => handleCardClick(card, selectedSection)}
                    cursor="pointer"
                    opacity={isCardSelected(card, selectedSection) ? 0.5 : 1}
                    _hover={{ opacity: 0.7 }}
                  >
                    <PlayingCard card={card} />
                  </Box>
                )
              })
            ))}
          </Grid>
        </VStack>
      </Box>
    </VStack>
  )
} 