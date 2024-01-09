import React from 'react';

const FooterComponent: React.FC = () => {
  return (
    <footer className='bg-lightGray mt-10 bg-opacity-10 py-10'>
      <div className='flex flex-row items-center justify-center gap-5'>
        <a
          className='flex cursor-pointer items-center justify-center w-12 h-12 border border-lightBlue rounded-full'
          href='https://www.linkedin.com/in/veeti-sorakivi-a5a556253/'
          target='_blank'
        >
          <i className='text-lg fa-brands fa-linkedin-in'></i>
        </a>
        <a
          className='flex cursor-pointer items-center justify-center w-12 h-12 border border-lightBlue rounded-full'
          href='https://github.com/Vege25'
          target='_blank'
        >
          <i className='text-lg fa-brands fa-github'></i>
        </a>
        <a
          className='flex cursor-pointer items-center justify-center w-12 h-12 border border-lightBlue rounded-full'
          href='mailto:v.sorakivi@gmail.com'
        >
          <i className='text-lg fa-regular fa-envelope'></i>
        </a>
      </div>
    </footer>
  );
};

export default FooterComponent;
