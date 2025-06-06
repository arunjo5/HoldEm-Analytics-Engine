import React, { useState } from 'react';
import { Box, Button, VStack, HStack, Text, Flex, useColorModeValue } from '@chakra-ui/react';
import { Card } from '@/app/page';
import { PlayingCard } from './PlayingCard';

interface Player {
  name: string;
  hand: Card[];
}

interface TableProps {
  players: (Player | null)[];
  onPlayerChange: (index: number, player: Player | null) => void;
  board: Card[];
  onBoardChange: (cards: Card[]) => void;
}

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export function Table({ players, onPlayerChange, board, onBoardChange }: TableProps) {
  const seatCount = 9;
  const radiusX = 260;
  const radiusY = 170;
  const centerX = 320;
  const centerY = 210;
  const [selectingPlayer, setSelectingPlayer] = useState<number | null>(null);
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);
  const [activeBoardIndex, setActiveBoardIndex] = useState<number | null>(null);

  const usedCards = [
    ...players.filter(Boolean).flatMap(player => player!.hand),
    ...board,
    ...selectedCards
  ];

  const isCardUsed = (card: Card, boardIndex?: number) => {
    if (boardIndex !== undefined && board[boardIndex] && board[boardIndex].suit === card.suit && board[boardIndex].value === card.value) {
      return false;
    }
    return usedCards.some(c => c.suit === card.suit && c.value === card.value);
  };

  const handleBoardCardClick = (index: number) => {
    setActiveBoardIndex(index);
  };

  const handleBoardCardSelect = (card: Card) => {
    if (activeBoardIndex === null) return;
    if (isCardUsed(card, activeBoardIndex)) return;
    const newBoard = [...board];
    newBoard[activeBoardIndex] = card;
    onBoardChange(newBoard.filter(Boolean));
    setActiveBoardIndex(null);
  };

  const handleAddClick = (seatIndex: number) => {
    setSelectingPlayer(seatIndex);
    setSelectedCards([]);
  };

  const handleCardSelectForPlayer = (card: Card) => {
    if (isCardUsed(card)) return;
    if (selectedCards.length < 2 && !selectedCards.some(c => c.suit === card.suit && c.value === card.value)) {
      const newSelected = [...selectedCards, card];
      setSelectedCards(newSelected);
      if (newSelected.length === 2 && selectingPlayer !== null) {
        onPlayerChange(selectingPlayer, { name: `Player ${selectingPlayer + 1}`, hand: newSelected });
        setSelectingPlayer(null);
        setSelectedCards([]);
      }
    }
  };

  const handleCancel = () => {
    setSelectingPlayer(null);
    setSelectedCards([]);
    setActiveBoardIndex(null);
  };

  return (
    <Flex direction="row" justify="center" align="center" w="auto" h="100%" minH="600px">
      <Box position="relative" w="640px" h="420px" mx="auto" mt={-150} flexShrink={0}>   
        <Box
          position="absolute"
          left={0}
          top={0}
          w="640px"
          h="420px"
          borderRadius="260px / 170px"
          bgGradient="linear(to-b, green.700 80%, green.900)"
          border="12px solid #b8864b"
          boxShadow="0 0 40px 0 #222"
          zIndex={0}
        />
        <HStack
          position="absolute"
          left="50%"
          top="50%"
          transform="translate(-50%, -50%)"
          spacing={5}
          zIndex={2}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <Box
              key={i}
              bg={activeBoardIndex === i ? 'blue.50' : 'white'}
              borderRadius="md"
              boxShadow="md"
              borderWidth={2}
              borderColor={board[i] ? 'blue.400' : 'gray.300'}
              w="48px"
              h="68px"
              display="flex"
              alignItems="center"
              justifyContent="center"
              cursor="pointer"
              onClick={() => handleBoardCardClick(i)}
              position="relative"
            >
              {board[i] ? <PlayingCard card={board[i]} /> : <Text color="gray.400">+</Text>}
            </Box>
          ))}
        </HStack>
        {Array.from({ length: seatCount }).map((_, i) => {
          const angle = (2 * Math.PI * i) / seatCount - Math.PI / 2;
          const x = centerX + radiusX * Math.cos(angle) - 36;
          const y = centerY + radiusY * Math.sin(angle) - 36;
          const player = players[i];
          return (
            <VStack
              key={i}
              position="absolute"
              left={`${x}px`}
              top={`${y}px`}
              spacing={3}
              align="center"
              zIndex={2}
            >
              <Box
                bg="white"
                borderRadius="lg"
                boxShadow="md"
                borderWidth={player ? 2 : 1}
                borderColor={player ? 'blue.400' : 'gray.300'}
                px={2}
                py={1}
                minW="60px"
                minH="45px"
                display="flex"
                flexDirection="column"
                alignItems="center"
                justifyContent="center"
              >
                {player ? (
                  <HStack mb={1}>
                    {player.hand.map((card, idx) => (
                      <PlayingCard key={idx} card={card} />
                    ))}
                  </HStack>
                ) : (
                  selectingPlayer === i ? (
                    <>
                      <Text fontSize="sm" color="gray.700" mb={2} fontWeight="bold">Select 2 cards</Text>
                      <HStack>
                        {selectedCards.map((card, idx) => (
                          <PlayingCard key={idx} card={card} />
                        ))}
                      </HStack>
                      <Button
                        size="xs"
                        mt={2}
                        bg={useColorModeValue('gray.200', 'gray.700')}
                        color={useColorModeValue('gray.800', 'white')}
                        _hover={{ bg: useColorModeValue('gray.300', 'gray.600') }}
                        onClick={handleCancel}
                      >
                        Cancel
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
                      onClick={() => handleAddClick(i)}
                    >
                      + Add
                    </Button>
                  )
                )}
              </Box>
              <Text fontSize="sm" color="white" fontWeight="bold" mt={1} textShadow="0 1px 4px #222">
                {player ? player.name : `Player ${i + 1}`}
              </Text>
            </VStack>
          );
        })}
      </Box>
      <Box  ml={8} p={5} mt={-100} bg="white" borderRadius="lg" boxShadow="md" minW="180px" maxW="180px" maxH="800px" overflowY="hidden" display="flex" flexDirection="column" alignItems="center">
        <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gridTemplateRows="repeat(13, 1fr)" gap={1} pt={1}>
          {VALUES.map((value, rowIdx) =>
            SUITS.map((suit, colIdx) => {
              const card: Card = { suit, value };
              const used = isCardUsed(card);
              const isSelectable = (
                (selectingPlayer !== null && !used && (!selectedCards.some(c => c.suit === card.suit && c.value === card.value)) && selectedCards.length < 2)
                || (activeBoardIndex !== null && !used)
              );
              return (
                <Box
                  key={`${value}-${suit}`}
                  w="32px"
                  h="45px"
                  borderRadius="md"
                  borderWidth={2}
                  borderColor={used ? 'gray.400' : 'gray.300'}
                  bg={used ? 'gray.100' : 'white'}
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  opacity={used ? 0.4 : isSelectable ? 1 : 0.7}
                  m={0}
                  p={0}
                  cursor={isSelectable ? 'pointer' : 'not-allowed'}
                  onClick={() => {
                    if (selectingPlayer !== null && isSelectable) handleCardSelectForPlayer(card);
                    if (activeBoardIndex !== null && isSelectable) handleBoardCardSelect(card);
                  }}
                >
                  <PlayingCard card={card} />
                </Box>
              );
            })
          )}
        </Box>
        {(activeBoardIndex !== null) && (
          <Button
            size="xs"
            mt={2}
            bg={useColorModeValue('gray.200', 'gray.700')}
            color={useColorModeValue('gray.800', 'white')}
            _hover={{ bg: useColorModeValue('gray.300', 'gray.600') }}
            onClick={handleCancel}
          >
            Cancel
          </Button>
        )}
      </Box>
    </Flex>
  );
} 