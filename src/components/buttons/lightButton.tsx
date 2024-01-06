import React from 'react';

interface LightButtonProps {
  // Add any
  text: string;
}

const LightButton: React.FC<LightButtonProps> = ({ text }) => {
  return (
    <div className='bg-lightGray text-dark px-4 py-2 rounded-md'>{text}</div>
  );
};

export default LightButton;
