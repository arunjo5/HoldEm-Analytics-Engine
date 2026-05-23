'use client'

import {
  Box,
  Container,
  Flex,
  Heading,
  useColorModeValue,
  HStack,
} from '@chakra-ui/react'
import { SignInButton } from './auth/SignInButton'
import { UserMenu } from './auth/UserMenu'
import { useAuth } from '@/contexts/AuthContext'

export function Header() {
  const { isAuthenticated, isLoading } = useAuth()
  const headerBg = useColorModeValue('rgba(255, 255, 255, 0.95)', 'rgba(26, 32, 44, 0.95)')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const headingColor = useColorModeValue('gray.800', 'white')
  const shadowColor = useColorModeValue('rgba(0, 0, 0, 0.1)', 'rgba(0, 0, 0, 0.3)')

  return (
    <Box
      as="header"
      bg={headerBg}
      borderBottom="1px"
      borderColor={borderColor}
      position="sticky"
      top={0}
      zIndex={1000}
      boxShadow={`0 2px 8px ${shadowColor}`}
      backdropFilter="blur(8px)"
    >
      <Container maxW="container.xl" py={4}>
        <Flex justify="space-between" align="center">
          <HStack spacing={3}>
            <Box
              w="10"
              h="10"
              borderRadius="full"
              bgGradient="linear(to-br, blue.400, purple.500)"
              display="flex"
              alignItems="center"
              justifyContent="center"
              color="white"
              fontSize="lg"
              fontWeight="bold"
              boxShadow="lg"
            >
              ♠️
            </Box>
            <Heading 
              size="lg" 
              color={headingColor}
              bgGradient="linear(to-r, blue.600, purple.600)"
              bgClip="text"
              fontWeight="bold"
            >
              Hold&apos;Em Analytics Engine
            </Heading>
          </HStack>
          
          <Flex align="center" gap={4}>
            {!isLoading && (
              <>
                {isAuthenticated ? (
                  <UserMenu />
                ) : (
                  <SignInButton />
                )}
              </>
            )}
          </Flex>
        </Flex>
      </Container>
    </Box>
  )
}
