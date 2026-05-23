'use client'

import { IconButton, useColorMode, useColorModeValue, Tooltip } from '@chakra-ui/react'
import { MoonIcon, SunIcon } from '@chakra-ui/icons'

export function ColorModeToggle() {
  const { colorMode, toggleColorMode } = useColorMode();
  
  const handleToggle = () => {
    console.log('Current color mode:', colorMode);
    toggleColorMode();
  };
  
  return (
    <Tooltip label={useColorModeValue('Switch to dark mode', 'Switch to light mode')}>
      <IconButton
        aria-label="Toggle color mode"
        icon={colorMode === 'light' ? <MoonIcon /> : <SunIcon />}
        onClick={handleToggle}
        variant="solid"
        size="lg"
        isRound
        boxShadow="lg"
        position="fixed"
        top="24px"
        right="32px"
        zIndex={9999}
        bg={useColorModeValue('white', 'gray.800')}
        color={useColorModeValue('gray.800', 'white')}
        _hover={{ 
          bg: useColorModeValue('gray.200', 'gray.700'),
          transform: 'scale(1.05)',
          boxShadow: 'xl'
        }}
        _active={{ 
          bg: useColorModeValue('gray.300', 'gray.600'),
          transform: 'scale(0.95)'
        }}
        _focus={{ 
          boxShadow: 'outline',
          outline: 'none'
        }}
        transition="all 0.2s ease-in-out"
      />
    </Tooltip>
  );
}
