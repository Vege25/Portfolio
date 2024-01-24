import React from 'react';

const Introduction: React.FC = () => {
  const scrollOffset = 80;
  const scrollTo = (elementId: string) => {
    const element = document.getElementById(elementId);

    if (element) {
      const offset = element.offsetTop - scrollOffset; // Adjust this value as needed
      window.scrollTo({
        top: offset,
        behavior: 'smooth',
      });
    }
  };
  return (
    <section id='introduceElement'>
      <div className='flex flex-col items-center justify-center h-screen gap-4 py-20'>
        <h1 className='text-5xl font-bold sm:text-7xl text-lightBlue'>
          Greetings!
        </h1>
        <p className='max-w-2xl px-12 text-center text-lightGray'>
          <strong className='text-lg text-darkBlue'>
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
          className='px-4 py-2 font-bold text-black transition-all duration-150 ease-in-out rounded-lg bg-lightBlue hover:scale-105'
          onClick={() => scrollTo('projectsElement')}
        >
          PROJECTS
        </button>
      </div>
      <div
        style={{ backgroundImage: 'url("/images/bg-2.jpg")' }}
        className='absolute top-0 left-0 w-full h-screen bg-center bg-cover opacity-30 -z-10'
      ></div>
    </section>
  );
};

export default Introduction;
