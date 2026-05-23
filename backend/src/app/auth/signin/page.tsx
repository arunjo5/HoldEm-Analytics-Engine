"use client"

import { Box, Container, VStack, Heading, Text, useColorModeValue } from "@chakra-ui/react"
import { Header } from "@/components/Header"
import { SignInButton } from "@/components/auth/SignInButton"

export default function SignInPage() {
  const bg = useColorModeValue('gray.50', 'gray.900')
  const headingColor = useColorModeValue('gray.800', 'white')
  const textColor = useColorModeValue('gray.600', 'gray.300')

  return (
    <Box minH="100vh" bg={bg}>
      <Header />
      <Container maxW="md" py={16}>
        <VStack spacing={6}>
          <Heading color={headingColor}>Sign in</Heading>
          <Text color={textColor} textAlign="center">
            Sign in with Google to save and revisit your past searches.
          </Text>
          <SignInButton />
        </VStack>
      </Container>
    </Box>
  )
}
