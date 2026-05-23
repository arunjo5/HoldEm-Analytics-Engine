'use client'

import { Button, useColorModeValue, HStack, Text, Box } from '@chakra-ui/react'
import { useAuth } from '@/contexts/AuthContext'

export function SignInButton() {
  const { signIn, isLoading } = useAuth()
  const buttonBg = useColorModeValue('white', 'gray.700')
  const buttonBorderColor = useColorModeValue('gray.200', 'gray.600')
  const buttonHoverBg = useColorModeValue('gray.50', 'gray.600')
  const textColor = useColorModeValue('gray.700', 'white')

  return (
    <Button
      onClick={signIn}
      isLoading={isLoading}
      loadingText="Signing in..."
      bg={buttonBg}
      color={textColor}
      border="1px"
      borderColor={buttonBorderColor}
      _hover={{ 
        bg: buttonHoverBg, 
        transform: 'translateY(-1px)',
        boxShadow: 'lg'
      }}
      _active={{ 
        bg: buttonHoverBg,
        transform: 'translateY(0)'
      }}
      size="lg"
      px={6}
      py={3}
      borderRadius="full"
      boxShadow="md"
      transition="all 0.2s ease-in-out"
      fontWeight="medium"
    >
      <HStack spacing={2}>
        <Box
          w="5"
          h="5"
          borderRadius="full"
          bg="red.500"
          display="flex"
          alignItems="center"
          justifyContent="center"
          color="white"
          fontSize="xs"
          fontWeight="bold"
        >
          G
        </Box>
        <Text>Sign in with Google</Text>
      </HStack>
    </Button>
  )
}
