import React from 'react';

const Introduction: React.FC = () => {
  return (
    <>
      <div className='h-screen py-20 flex items-center justify-center flex-col gap-4'>
        <h1 className='text-5xl sm:text-7xl font-bold text-lightBlue'>
          Greetings!
        </h1>
        <p className='text-lightGray text-center px-12 max-w-2xl'>
          <strong className='text-darkBlue text-lg'>
            I'm Veeti Sorakivi,{' '}
          </strong>
          a full-stack web developer on a mission to make the web a more
          beautiful and functional space. Dive into my projects, where
          innovation meets clean code.
        </p>
        <button
          style={{
            MozBoxShadow: '0px 1px 21px -1px rgba(0,0,0,0.49);',
            WebkitBoxShadow: '0px 1px 21px -1px rgba(0,0,0,0.49);',
            boxShadow: '0px 1px 21px -1px rgba(0,0,0,0.49);',
          }}
          className='bg-lightBlue text-black font-bold px-4 py-2 rounded-lg'
        >
          PROJECTS
        </button>
      </div>
      <div
        style={{ backgroundImage: 'url("/images/bg-2.jpg")' }}
        className='bg-cover opacity-30 bg-center h-screen w-screen absolute top-0 left-0 -z-10'
      ></div>
    </>
  );
};

export default Introduction;
